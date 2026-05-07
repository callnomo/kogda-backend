require('dotenv').config()
const { spawn } = require('child_process')
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const fs = require('fs')
const path = require('path')
const os = require('os')
const zlib = require('zlib')

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_BUCKET
const RETENTION_DAYS = 30

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function dumpAndCompress(databaseUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const dump = spawn('pg_dump', ['--dbname=' + databaseUrl])
    const gzip = zlib.createGzip()
    const output = fs.createWriteStream(outputPath)

    let stderrBuffer = ''
    dump.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString()
    })

    dump.on('error', (err) => reject(new Error(`pg_dump spawn error: ${err.message}`)))
    dump.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pg_dump exited with code ${code}: ${stderrBuffer}`))
      }
    })

    output.on('finish', () => resolve())
    output.on('error', reject)

    dump.stdout.pipe(gzip).pipe(output)
  })
}

async function backup() {
  const timestamp = new Date().toISOString().split('T')[0] + '_' + Date.now()
  const filename = `kogda-backup-${timestamp}.sql.gz`
  const tmpPath = path.join(os.tmpdir(), filename)

  console.log(`[backup] Старт бэкапа: ${filename}`)

  try {
    console.log('[backup] Делаем pg_dump...')
    await dumpAndCompress(process.env.DATABASE_URL, tmpPath)

    const stats = fs.statSync(tmpPath)
    console.log(`[backup] Дамп готов, размер: ${formatSize(stats.size)}`)

    if (stats.size < 1024) {
      throw new Error(`Дамп подозрительно маленький (${stats.size} байт). Прерываем.`)
    }

    console.log('[backup] Загружаем в R2...')
    const fileStream = fs.readFileSync(tmpPath)
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: filename,
      Body: fileStream,
      ContentType: 'application/gzip',
    }))
    console.log(`[backup] Загружено: ${filename}`)

    fs.unlinkSync(tmpPath)

    console.log('[backup] Чистим старые бэкапы...')
    await cleanOldBackups()

    console.log('[backup] ✅ Готово!')
    return { success: true, filename, size: stats.size }
  } catch (err) {
    console.error('[backup] ❌ Ошибка:', err.message)
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    throw err
  }
}

async function cleanOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }))

  if (!list.Contents) return

  let deleted = 0
  for (const obj of list.Contents) {
    if (obj.LastModified.getTime() < cutoff) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }))
      console.log(`[backup] Удалён старый: ${obj.Key}`)
      deleted++
    }
  }
  console.log(`[backup] Удалено старых бэкапов: ${deleted}`)
}

if (require.main === module) {
  backup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

module.exports = { backup }
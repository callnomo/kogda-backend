const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')

// R2 для аватарок и обложек
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_AVATARS_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_AVATARS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_AVATARS_BUCKET
const PUBLIC_URL = process.env.R2_AVATARS_PUBLIC_URL

// Загрузить аватар в R2 → вернуть публичный URL
async function uploadAvatar(buffer, mimetype, userId) {
  const ext = mimetype.split('/')[1] || 'jpg'
  const key = `avatars/user-${userId}-${Date.now()}.${ext}`

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }))

  return `${PUBLIC_URL}/${key}`
}

// Удалить аватар из R2 по URL
async function deleteAvatar(url) {
  if (!url || !url.startsWith(PUBLIC_URL)) return
  const key = url.replace(`${PUBLIC_URL}/`, '')

  try {
    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }))
  } catch (err) {
    console.error('R2 delete error:', err)
  }
}

// Загрузить обложку в R2 → вернуть публичный URL
async function uploadCover(buffer, mimetype, userId) {
  const ext = mimetype.split('/')[1] || 'jpg'
  const key = `covers/user-${userId}-${Date.now()}.${ext}`

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }))

  return `${PUBLIC_URL}/${key}`
}

// Удалить обложку из R2 по URL
async function deleteCover(url) {
  if (!url || !url.startsWith(PUBLIC_URL)) return
  const key = url.replace(`${PUBLIC_URL}/`, '')

  try {
    await r2.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }))
  } catch (err) {
    console.error('R2 delete error:', err)
  }
}

module.exports = { uploadAvatar, deleteAvatar, uploadCover, deleteCover }
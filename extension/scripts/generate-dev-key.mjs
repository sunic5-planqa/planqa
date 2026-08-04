import { createHash, generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Generates a fixed dev-only RSA keypair for the extension. Chrome derives the extension's
// id from the public key, so pinning this key keeps the id stable across reloads/rebuilds —
// otherwise the backend's ALLOWED_ORIGINS allowlist would break on every unpacked reload.
// This key is NOT for Chrome Web Store publishing.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const publicKeyBase64 = publicKey.toString('base64')

const idHex = createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
const extensionId = idHex
  .split('')
  .map((digit) => String.fromCharCode('a'.charCodeAt(0) + parseInt(digit, 16)))
  .join('')

writeFileSync(path.join(root, 'dev-key.pem'), privateKey)
writeFileSync(path.join(root, 'dev-key.public.txt'), `${publicKeyBase64}\n`)
writeFileSync(path.join(root, 'DEV_EXTENSION_ID.txt'), `${extensionId}\n`)

console.log(`Extension id (pinned): ${extensionId}`)
console.log('Set this in the backend .env as:')
console.log(`ALLOWED_ORIGINS=chrome-extension://${extensionId},http://localhost:5173`)

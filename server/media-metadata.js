const path = require('node:path');

const MIME_BY_EXTENSION = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm'
};

const mimeFromName = (name) => (
  MIME_BY_EXTENSION[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream'
);

const normalizeMediaMetadata = (originalName, mime) => {
  const normalizedName = path.basename(String(originalName || '').replace(/\\/g, '/'));
  const baseMime = String(mime || '').split(';', 1)[0].trim().toLowerCase();
  const shouldInferMime = !baseMime || baseMime === 'application/octet-stream';
  const inferredMime = mimeFromName(normalizedName);

  return {
    originalName: normalizedName,
    mime: shouldInferMime ? inferredMime : mime
  };
};

module.exports = { mimeFromName, normalizeMediaMetadata };

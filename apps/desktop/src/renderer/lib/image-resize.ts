/** Turns a user-picked image file into a small square JPEG data URL, so an account avatar
 *  never sends a multi-megabyte original over RPC or stores one in the host's kv. All DOM
 *  (`Image`, `canvas`, `FileReader`) — there is no `node:test`-reachable logic here to cover
 *  with a unit test, the same way `components/Avatar.tsx`'s canvas drawing isn't either; the
 *  size/shape math it depends on (`isValidAvatarDataUrl`) is covered separately in
 *  `profile.test.ts`. */

/** Reads `file`, center-crops it to a square, and scales that down to `size`×`size`, returning
 *  a JPEG data URL. Rejects anything that isn't an image file before ever touching the DOM. */
export function resizeImageFileToAvatar(file: File, size = 160): Promise<string> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('请选择一张图片文件'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('无法识别这张图片'))
      img.onload = () => {
        try {
          resolve(drawSquareJpeg(img, size))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function drawSquareJpeg(img: HTMLImageElement, size: number): string {
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法处理图片')
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.85)
}

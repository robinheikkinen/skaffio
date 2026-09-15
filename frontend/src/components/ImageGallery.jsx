import { useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { imageUrl, thumbFallback } from '../utils/imageUrl'

export default function ImageGallery({ images }) {
  const [lightbox, setLightbox] = useState(null)

  if (!images || images.length === 0) return null

  const prev = () => setLightbox((i) => (i > 0 ? i - 1 : images.length - 1))
  const next = () => setLightbox((i) => (i < images.length - 1 ? i + 1 : 0))

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {images.map((img, idx) => (
          <button
            key={img.id}
            onClick={() => setLightbox(idx)}
            className="aspect-square rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
          >
            <img
              src={imageUrl(img.filename, { thumb: true })}
              onError={thumbFallback(img.filename)}
              alt={img.original_name}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>

      {lightbox !== null && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300"
          >
            <X size={28} />
          </button>
          {images.length > 1 && (
            <>
              <button onClick={prev} className="absolute left-4 text-white hover:text-gray-300">
                <ChevronLeft size={36} />
              </button>
              <button onClick={next} className="absolute right-4 text-white hover:text-gray-300">
                <ChevronRight size={36} />
              </button>
            </>
          )}
          <img
            src={imageUrl(images[lightbox].filename)}
            alt={images[lightbox].original_name}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        </div>
      )}
    </>
  )
}

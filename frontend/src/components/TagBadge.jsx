export default function TagBadge({ tag }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold text-white shadow-sm"
      style={{ backgroundColor: tag.color || '#6B7280' }}
    >
      {tag.name}
    </span>
  )
}

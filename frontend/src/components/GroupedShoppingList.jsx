import { useState } from 'react'
import {
  Snowflake, Refrigerator, Sparkles, Check, X,
  Apple, Beef, Milk, Package, Wheat, ShoppingBasket, Pencil, GripVertical,
} from 'lucide-react'
import { DragDropContext, Draggable } from 'react-beautiful-dnd'
import StrictModeDroppable from './StrictModeDroppable'
import { MascotBo } from './Mascots'

const CATEGORY_ORDER = ['Frukt & Grönt', 'Kött & Fisk', 'Mejeri', 'Skafferi', 'Fryst', 'Bröd', 'Övrigt']

const CATEGORY_STYLE = {
  'Frukt & Grönt': { Icon: Apple,           accent: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' },
  'Kött & Fisk':   { Icon: Beef,            accent: 'bg-rose-50 text-rose-700       dark:bg-rose-950/30 dark:text-rose-300' },
  'Mejeri':        { Icon: Milk,            accent: 'bg-sky-50 text-sky-700         dark:bg-sky-950/30 dark:text-sky-300' },
  'Skafferi':      { Icon: Package,         accent: 'bg-amber-50 text-amber-800     dark:bg-amber-950/30 dark:text-amber-300' },
  'Fryst':         { Icon: Snowflake,       accent: 'bg-indigo-50 text-indigo-700   dark:bg-indigo-950/30 dark:text-indigo-300' },
  'Bröd':          { Icon: Wheat,           accent: 'bg-yellow-50 text-yellow-800   dark:bg-yellow-950/30 dark:text-yellow-300' },
  'Övrigt':        { Icon: ShoppingBasket,  accent: 'bg-gray-100 text-gray-700      dark:bg-white/5 dark:text-gray-300' },
}

function LocationPill({ location }) {
  if (!location) return null
  const isFreezer = /frys|freezer/i.test(location)
  const Icon = isFreezer ? Snowflake : Refrigerator
  return (
    <span className="location-pill">
      <Icon size={10} strokeWidth={2.6} />
      {location}
    </span>
  )
}

function Row({ item, onToggle, onDelete, onEdit, compact = false, innerRef, draggableProps, dragHandleProps, isDragging = false }) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const inStock = item.available_at_home

  const startEdit = (e) => {
    e.stopPropagation()
    const parts = [item.amount, item.unit, item.name].filter(Boolean).join(' ')
    setEditText(parts.trim() || item.name)
    setEditing(true)
  }

  const commitEdit = (e) => {
    e?.stopPropagation()
    if (editText.trim()) onEdit(editText.trim())
    setEditing(false)
  }

  const cancelEdit = (e) => {
    e?.stopPropagation()
    setEditing(false)
  }

  if (editing) {
    return (
      <li ref={innerRef} {...draggableProps} className={`list-row ${compact ? 'py-2.5 min-h-[48px]' : ''}`}>
        {dragHandleProps && (
          <span {...dragHandleProps} className="shrink-0 -ml-1 p-1 text-gray-300 dark:text-gray-600 touch-none">
            <GripVertical size={15} />
          </span>
        )}
        <input
          autoFocus
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitEdit(e)
            if (e.key === 'Escape') cancelEdit(e)
          }}
          onClick={e => e.stopPropagation()}
          className="flex-1 px-2 py-1 text-sm rounded-lg border border-primary/40 bg-white dark:bg-white/5
                     focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={commitEdit}
          className="shrink-0 p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
        >
          <Check size={14} strokeWidth={3} />
        </button>
        <button
          onClick={cancelEdit}
          className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={14} />
        </button>
      </li>
    )
  }

  return (
    <li
      ref={innerRef}
      {...draggableProps}
      onClick={onToggle}
      className={`list-row ${item.checked ? 'is-checked' : ''} ${inStock ? 'in-stock' : ''} ${compact ? 'py-2.5 min-h-[48px]' : ''}
                  ${isDragging ? 'shadow-lg ring-2 ring-primary/30 bg-white dark:bg-gray-800 rounded-2xl' : ''}`}
    >
      {dragHandleProps && (
        <span
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 -ml-1 p-1 text-gray-300 dark:text-gray-600 touch-none cursor-grab active:cursor-grabbing"
          title="Dra för att flytta"
        >
          <GripVertical size={15} />
        </span>
      )}
      <span className={`check-dot ${item.checked ? 'is-checked' : ''}`}>
        {item.checked && <Check size={14} strokeWidth={3} className="text-white" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`flex items-center gap-2 flex-wrap ${item.checked ? 'line-through' : ''}`}>
          <span className="font-medium text-[15px]">{item.name}</span>
          {inStock && <LocationPill location={item.location} />}
        </div>
        {(item.amount || item.unit || item.recipe_title) && (
          <div className="flex items-center gap-2 text-[12px] text-gray-500 mt-0.5">
            {(item.amount || item.unit) && <span>{item.amount} {item.unit}</span>}
            {item.recipe_title && <span className="text-gray-400">· {item.recipe_title}</span>}
          </div>
        )}
      </div>
      {inStock && !compact && (
        <span className="shrink-0 text-[11px] font-semibold text-sage-700 dark:text-sage-300
                          bg-sage-100 dark:bg-sage-900/40 px-2.5 py-1 rounded-full
                          flex items-center gap-1">
          <Sparkles size={11} strokeWidth={2.6} />
          Hemma
        </span>
      )}
      {onEdit && (
        <button
          onClick={startEdit}
          className="shrink-0 p-1.5 -mr-0.5 rounded-lg text-gray-300 hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <Pencil size={13} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="shrink-0 p-1.5 -mr-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </li>
  )
}

export default function GroupedShoppingList({ items, onToggle, onDelete, onEdit, onReorder, hideInStock = false, compact = false }) {
  const grouped = {}
  items.forEach((item, idx) => {
    if (hideInStock && item.available_at_home) return
    const cat = item.category || 'Övrigt'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push({ ...item, _origIndex: idx })
  })

  const sortedCats = Object.keys(grouped).sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a))
            - (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b))
  )

  // Dra & släpp: bygg om HELA items-arrayen (ordningen ÄR arrayordningen i DB:n).
  // _origIndex kopplar visuell position → index i fulla arrayen, så dolda
  // "finns hemma"-varor behåller sin plats. Släpps varan i en annan kategori
  // byter den även kategori.
  const handleDragEnd = (result) => {
    const { source, destination } = result
    if (!destination || !onReorder) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const fromOrig = grouped[source.droppableId][source.index]._origIndex
    const movedItem = { ...items[fromOrig] }
    if (destination.droppableId !== source.droppableId) {
      movedItem.category = destination.droppableId
    }

    // Destinationskategorins synliga rader — utan den flyttade varan
    const destVisual = destination.droppableId === source.droppableId
      ? grouped[destination.droppableId].filter((_, i) => i !== source.index)
      : grouped[destination.droppableId]

    const newItems = items.filter((_, i) => i !== fromOrig)
    let insertAt
    if (destination.index >= destVisual.length) {
      // Sist i kategorin — direkt efter kategorins sista vara
      const lastOrig = destVisual.length ? destVisual[destVisual.length - 1]._origIndex : -1
      insertAt = lastOrig === -1 ? newItems.length : (lastOrig > fromOrig ? lastOrig - 1 : lastOrig) + 1
    } else {
      // Före varan som nu står på målplatsen
      const anchorOrig = destVisual[destination.index]._origIndex
      insertAt = anchorOrig > fromOrig ? anchorOrig - 1 : anchorOrig
    }
    newItems.splice(insertAt, 0, movedItem)
    onReorder(newItems)
  }

  if (sortedCats.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 gap-3 text-center">
        <MascotBo size={110} animation="jump" />
        <p className="text-gray-400 text-sm font-medium">Allt inhandlat! ✓</p>
      </div>
    )
  }

  const sections = sortedCats.map((cat) => {
    const { Icon, accent } = CATEGORY_STYLE[cat] || CATEGORY_STYLE['Övrigt']
    const catItems = grouped[cat]
    const remaining = catItems.filter((i) => !i.checked).length
    return (
      <section key={cat}>
        <header className="flex items-center gap-2.5 px-1 mb-2">
          <span className={`w-7 h-7 rounded-xl flex items-center justify-center ${accent}`}>
            <Icon size={15} strokeWidth={2.4} />
          </span>
          <h3 className="font-semibold text-[13px] uppercase tracking-wider">{cat}</h3>
          <span className="text-[11px] text-gray-400 font-medium">{remaining}/{catItems.length}</span>
        </header>
        {onReorder ? (
          <StrictModeDroppable droppableId={cat}>
            {(provided) => (
              <ul ref={provided.innerRef} {...provided.droppableProps} className="space-y-0.5 -mx-2">
                {catItems.map((item, pos) => (
                  <Draggable key={String(item._origIndex)} draggableId={String(item._origIndex)} index={pos}>
                    {(dragProvided, snapshot) => (
                      <Row
                        item={item}
                        compact={compact}
                        innerRef={dragProvided.innerRef}
                        draggableProps={dragProvided.draggableProps}
                        dragHandleProps={dragProvided.dragHandleProps}
                        isDragging={snapshot.isDragging}
                        onToggle={() => onToggle(item._origIndex)}
                        onDelete={onDelete ? () => onDelete(item._origIndex) : null}
                        onEdit={onEdit ? (text) => onEdit(item._origIndex, text) : null}
                      />
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </ul>
            )}
          </StrictModeDroppable>
        ) : (
          <ul className="space-y-0.5 -mx-2">
            {catItems.map((item) => (
              <Row
                key={item._origIndex}
                item={item}
                compact={compact}
                onToggle={() => onToggle(item._origIndex)}
                onDelete={onDelete ? () => onDelete(item._origIndex) : null}
                onEdit={onEdit ? (text) => onEdit(item._origIndex, text) : null}
              />
            ))}
          </ul>
        )}
      </section>
    )
  })

  if (!onReorder) return <div className="space-y-5">{sections}</div>

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="space-y-5">{sections}</div>
    </DragDropContext>
  )
}

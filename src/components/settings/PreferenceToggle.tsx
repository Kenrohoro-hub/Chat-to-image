export default function PreferenceToggle({ label, description, checked, onChange }: {
  label: string
  description: string
  checked: boolean
  onChange: () => void
}) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
    <span className="min-w-0"><span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span><span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">{description}</span></span>
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={onChange} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" />
      <span className="h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 dark:bg-gray-600" />
      <span className="pointer-events-none absolute left-[7px] h-3.5 w-3.5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </span>
  </label>
}

export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-white/5 rounded-xl w-1/3 mx-auto" />
        <div className="h-12 bg-white/5 rounded-xl max-w-3xl mx-auto" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-40 bg-white/5 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

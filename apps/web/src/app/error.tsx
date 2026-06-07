"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <p className="text-4xl">⚠️</p>
      <p className="text-white font-semibold">Something went wrong</p>
      <p className="text-gray-400 text-sm max-w-md text-center">{error.message}</p>
      <button onClick={reset} className="btn-primary mt-2">Try again</button>
    </div>
  );
}

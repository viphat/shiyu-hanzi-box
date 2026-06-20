import { useInbox } from './hooks/useInbox';

export function App() {
  const { inbox, loading } = useInbox();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 text-ink">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <h1 className="text-xl font-semibold text-jade-700">拾语汉字box</h1>
          <p className="text-sm text-gray-500">
            {inbox.words.length} words · {inbox.quotes.length} quotes
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-6">
        <p className="text-sm text-gray-500">
          Dashboard wiring complete. UI populated in next task.
        </p>
      </main>
    </div>
  );
}

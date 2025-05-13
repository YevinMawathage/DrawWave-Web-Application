import VirtualPainter from './components/VirtualPainter';

function App() {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 to-indigo-100 p-0 overflow-x-hidden">
      <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-indigo-700 py-4 sm:py-6">AI Virtual Painter</h1>
      <VirtualPainter />
    </div>
  );
}

export default App;

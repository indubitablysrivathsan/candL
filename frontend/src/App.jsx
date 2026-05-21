// frontend/src/App.jsx

import {
  BrowserRouter,
  Routes,
  Route
} from 'react-router-dom';

import Navbar from './components/layout/Navbar';

import Options from './pages/Options';
import Futures from './pages/Futures';
import Stocks from './pages/Stocks';
import Indexes from './pages/Indexes';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-white">
        <Navbar />

        <Routes>
          <Route
            path="/options"
            element={<Options />}
          />

          <Route
            path="/futures"
            element={<Futures />}
          />

          <Route
            path="/stocks"
            element={<Stocks />}
          />

          <Route
            path="/indexes"
            element={<Indexes />}
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
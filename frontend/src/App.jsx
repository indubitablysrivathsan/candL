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
import Market from './pages/Market';
import Participants from './pages/Participants';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-white">
        <Navbar />

        <Routes>
          <Route path="/sto" element={<Options key="stock-options" assetType="stock_options" />} />
          <Route path="/stf" element={<Futures key="stock-futures" assetType="stock_futures" />} />
          <Route path="/ido" element={<Options key="index-options" assetType="index_options" />} />
          <Route path="/idf" element={<Futures key="index-futures" assetType="index_futures" />} />
          <Route path="/stocks" element={<Stocks />} />
          <Route path="/market" element={<Market />} />
          <Route path="/participants" element={<Participants />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
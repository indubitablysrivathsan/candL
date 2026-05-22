// frontend/src/pages/Indexes.jsx

import { useState } from 'react';
import Futures from './Futures';
import Options from './Options';

export default function Indexes() {
  const [mode, setMode] = useState('futures');

  return (
    <div className="flex flex-col h-full">
      {/* ── Mode toggle bar ── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/8 bg-[#0e1219]">
        <span className="text-sm text-white/45 mr-1">Index</span>

        <button
          onClick={() => setMode('futures')}
          className={`px-4 py-2 rounded-xl border text-sm transition ${
            mode === 'futures'
              ? 'border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726]'
              : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
          }`}
        >
          Index Futures
        </button>

        <button
          onClick={() => setMode('options')}
          className={`px-4 py-2 rounded-xl border text-sm transition ${
            mode === 'options'
              ? 'border-[#00B0F0]/30 bg-[#00B0F0]/10 text-[#00B0F0]'
              : 'border-white/10 bg-[#151922] text-white/65 hover:bg-white/5'
          }`}
        >
          Index Options
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto">
        {mode === 'futures' && <Futures key="index-futures" assetType="index_futures" />}
        {mode === 'options' && <Options key="index-options" assetType="index_options" />}
      </div>
    </div>
  );
}
import React from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  isSpeaking: boolean; // True if AI is speaking
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, isSpeaking }) => {
  return (
    <div className="flex items-center justify-center h-48 w-full">
      <div className="relative">
        {/* Outer Ring */}
        {isActive && (
          <div className={`absolute inset-0 bg-blue-400 rounded-full blur-xl opacity-30 ${isSpeaking ? 'animate-pulse' : 'scale-100'}`}></div>
        )}
        
        {/* Core Circle */}
        <div className={`
          relative z-10 w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500
          ${isActive 
            ? isSpeaking 
              ? 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-[0_0_40px_rgba(59,130,246,0.6)] scale-110' 
              : 'bg-gradient-to-br from-blue-400 to-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)] animate-pulse-ring' 
            : 'bg-slate-300 shadow-inner'
          }
        `}>
          {isActive ? (
             isSpeaking ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-white animate-bounce">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.426-1.582 1.052-2.097H6.75z" />
                </svg>
             ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-white">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
             )
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-slate-500">
               <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          )}
        </div>
      </div>
      
      <div className="absolute mt-48 text-center">
        <p className="text-sm font-medium text-slate-500 uppercase tracking-widest">
            {isActive ? (isSpeaking ? "SMC Asistente Hablando..." : "Escuchando...") : "Desconectado"}
        </p>
      </div>
    </div>
  );
};
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  GoogleGenAI, 
  LiveServerMessage, 
  Modality, 
  FunctionDeclaration, 
  Type 
} from '@google/genai';
import { SYSTEM_INSTRUCTION } from './constants';
import { AudioVisualizer } from './components/AudioVisualizer';
import { ConnectionState, SupportTicket } from './types';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from './utils/audioUtils';

// Tool Definition
const ticketFunctionDeclaration: FunctionDeclaration = {
  name: 'saveSupportTicket',
  description: 'Guarda el ticket de soporte con la información recopilada del usuario.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      nombre: { type: Type.STRING, description: 'Nombre del usuario' },
      correo: { type: Type.STRING, description: 'Correo electrónico del usuario' },
      municipalidad: { type: Type.STRING, description: 'Municipalidad del usuario' },
      area: { type: Type.STRING, description: 'Área del sistema (ej: Tránsito, Rentas)' },
      modulo: { type: Type.STRING, description: 'Módulo específico o equipamiento' },
      problema: { type: Type.STRING, description: 'Descripción detallada del problema' },
    },
    required: ['nombre', 'correo', 'municipalidad', 'area', 'modulo', 'problema'],
  },
};

export default function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null); // To store the active session
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Initialize the Gemini Client
  // NOTE: In a real production app, you might want to fetch a temporary token from your backend 
  // rather than exposing the API key directly if this is client-side only. 
  // However, for this demo per instructions, we use process.env.API_KEY.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const disconnect = useCallback(() => {
    // 1. Close session if exists (the SDK doesn't always expose a clean close on the promise result, 
    // but usually closing the socket is handled by the browser or we stop sending)
    // There isn't a direct .close() on the session object in the current preview types easily accessible 
    // outside the callbacks, but stopping the stream stops input.
    
    // 2. Stop Microphone Stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // 3. Close Audio Contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // 4. Stop all playing sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();

    setConnectionState(ConnectionState.DISCONNECTED);
    setIsSpeaking(false);
  }, []);

  const connect = async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);
      setErrorMsg(null);
      setTicket(null);

      // Setup Audio Contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Setup Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: [ticketFunctionDeclaration] }],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, // Professional tone
          },
        },
      };

      // Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        ...config,
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            
            // Start Audio Stream Processing
            if (!inputAudioContextRef.current || !streamRef.current) return;
            
            const source = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
            const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Tool Calls (Save Ticket)
            if (message.toolCall) {
               for (const fc of message.toolCall.functionCalls) {
                  if (fc.name === 'saveSupportTicket') {
                    const args = fc.args as unknown as SupportTicket;
                    setTicket(args);
                    
                    // Send response back to model
                    sessionPromise.then(session => {
                        session.sendToolResponse({
                            functionResponses: {
                                id: fc.id,
                                name: fc.name,
                                response: { result: "Ticket guardado exitosamente." }
                            }
                        });
                    });
                  }
               }
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              try {
                // Ensure we track start time for smooth playback
                const ctx = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                  base64ToUint8Array(base64Audio), 
                  ctx, 
                  24000, 
                  1
                );
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                const gainNode = ctx.createGain();
                gainNode.gain.value = 1.0; 
                source.connect(gainNode);
                gainNode.connect(ctx.destination);
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                
                sourcesRef.current.add(source);
                setIsSpeaking(true);

                source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0) {
                    setIsSpeaking(false);
                  }
                };
              } catch (err) {
                console.error("Error processing audio chunk", err);
              }
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              setIsSpeaking(false);
              nextStartTimeRef.current = 0;
            }
          },
          onclose: () => {
            setConnectionState(ConnectionState.DISCONNECTED);
            setIsSpeaking(false);
          },
          onerror: (err) => {
            console.error(err);
            setConnectionState(ConnectionState.ERROR);
            setErrorMsg("Error de conexión con el servidor.");
          }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (e) {
      console.error(e);
      setConnectionState(ConnectionState.ERROR);
      setErrorMsg("No se pudo acceder al micrófono o conectar con el servicio.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">SMC</span>
            </div>
            <h1 className="text-xl font-semibold text-slate-800 tracking-tight">Asistente de Voz</h1>
          </div>
          <div className="text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            Soporte Municipal v2.5
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col items-center justify-center p-4">
        
        {/* Error Message */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg max-w-md text-center shadow-sm">
            {errorMsg}
          </div>
        )}

        {/* Ticket Summary Card (Generated by AI) */}
        {ticket && (
          <div className="mb-8 w-full max-w-2xl bg-white rounded-xl shadow-lg border border-blue-100 overflow-hidden animate-fade-in-up">
             <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 flex justify-between items-center">
                <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Ticket Generado Exitosamente
                </h2>
                <span className="text-blue-100 text-xs bg-white/20 px-2 py-1 rounded">#{Math.floor(Math.random() * 9000) + 1000}</span>
             </div>
             <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <div>
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Solicitante</label>
                   <p className="text-slate-800 font-medium">{ticket.nombre}</p>
                   <p className="text-slate-500 text-sm">{ticket.correo}</p>
                </div>
                <div>
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Municipalidad</label>
                   <p className="text-slate-800 font-medium">{ticket.municipalidad}</p>
                </div>
                <div>
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Área</label>
                   <p className="text-slate-800 font-medium">{ticket.area}</p>
                </div>
                <div>
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Módulo</label>
                   <p className="text-blue-600 font-medium bg-blue-50 inline-block px-2 rounded -ml-1">{ticket.modulo}</p>
                </div>
                <div className="md:col-span-2 mt-2 pt-4 border-t border-slate-100">
                   <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Descripción del Problema</label>
                   <p className="text-slate-700 mt-1 leading-relaxed bg-slate-50 p-3 rounded-lg text-sm border border-slate-100">
                     {ticket.problema}
                   </p>
                </div>
             </div>
             <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 flex justify-between items-center">
                <span className="text-xs text-slate-500">Derivado al departamento de soporte técnico.</span>
                <button className="text-blue-600 text-sm font-medium hover:underline">Descargar PDF</button>
             </div>
          </div>
        )}

        {/* Interaction Area */}
        <div className="flex flex-col items-center gap-8 w-full max-w-md">
          
          <AudioVisualizer 
            isActive={connectionState === ConnectionState.CONNECTED} 
            isSpeaking={isSpeaking}
          />

          <div className="flex flex-col gap-3 w-full">
            {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
               <button
                  onClick={connect}
                  className="group relative w-full flex justify-center py-4 px-4 border border-transparent text-sm font-medium rounded-full text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                >
                  <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                    <svg className="h-5 w-5 text-blue-300 group-hover:text-blue-200" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                  </span>
                  Iniciar Conversación
                </button>
            ) : connectionState === ConnectionState.CONNECTING ? (
              <button disabled className="w-full flex justify-center py-4 px-4 border border-transparent text-sm font-medium rounded-full text-white bg-slate-400 cursor-not-allowed">
                 <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                 </svg>
                 Conectando...
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="w-full flex justify-center py-4 px-4 border border-transparent text-sm font-medium rounded-full text-white bg-red-500 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-all shadow-md"
              >
                Terminar Llamada
              </button>
            )}
          </div>
          
          <div className="text-center max-w-xs">
            <p className="text-xs text-slate-400">
              SMC utiliza inteligencia artificial para mejorar su experiencia de soporte.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}
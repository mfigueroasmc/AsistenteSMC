export interface SupportTicket {
  nombre: string;
  correo: string;
  municipalidad: string;
  area: string;
  modulo: string;
  problema: string;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface AudioVisualizerProps {
  isPlaying: boolean;
  volume: number;
}

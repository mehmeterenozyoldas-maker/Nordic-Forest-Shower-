import { HardwareConnectionState } from '../types/simulation';
import { ParsedLivePacket, parseLiveSensorPacket } from './sensorParser';

const NORDIC_UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

interface BleCharacteristicLike extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BleCharacteristicLike>;
}

interface BleServiceLike {
  getCharacteristic(uuid: string): Promise<BleCharacteristicLike>;
}

interface BleServerLike {
  connected: boolean;
  connect(): Promise<BleServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleServiceLike>;
}

interface BleDeviceLike extends EventTarget {
  name?: string;
  gatt?: BleServerLike;
}

interface NavigatorWithBluetooth extends Navigator {
  bluetooth?: {
    requestDevice(options: {
      filters?: Array<{ namePrefix?: string; services?: string[] }>;
      acceptAllDevices?: boolean;
      optionalServices?: string[];
    }): Promise<BleDeviceLike>;
  };
}

export class HardwareBridge {
  private bleDevice: BleDeviceLike | null = null;
  private bleChar: BleCharacteristicLike | null = null;
  private ws: WebSocket | null = null;
  private readonly decoder = new TextDecoder('utf-8');

  private onPacket: (packet: ParsedLivePacket, raw: string, via: 'ble' | 'websocket') => void;
  private onStatus: (state: HardwareConnectionState) => void;

  private state: HardwareConnectionState = {
    bleStatus: 'disconnected',
    bleDeviceName: null,
    bleError: null,
    wsStatus: 'disconnected',
    wsUrl: 'ws://192.168.4.1:81',
    wsError: null,
    packetCount: 0,
    lastPacket: null,
  };

  constructor(
    onPacket: (packet: ParsedLivePacket, raw: string, via: 'ble' | 'websocket') => void,
    onStatus: (state: HardwareConnectionState) => void,
  ) {
    this.onPacket = onPacket;
    this.onStatus = onStatus;
  }

  public get status(): HardwareConnectionState {
    return this.state;
  }

  private emitStatus(): void {
    this.onStatus({ ...this.state });
  }

  public async connectBle(): Promise<void> {
    const nav = navigator as NavigatorWithBluetooth;
    if (!nav.bluetooth) {
      this.state.bleStatus = 'error';
      this.state.bleError =
        'Web Bluetooth requires Chrome or Edge over HTTPS/localhost.';
      this.emitStatus();
      return;
    }

    this.state.bleStatus = 'connecting';
    this.state.bleError = null;
    this.emitStatus();

    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ESP32' },
          { namePrefix: 'Arduino' },
          { namePrefix: 'Nordic' },
        ],
        optionalServices: [NORDIC_UART_SERVICE],
      });

      this.bleDevice = device;
      device.addEventListener('gattserverdisconnected', () => {
        this.state.bleStatus = 'disconnected';
        this.state.bleDeviceName = null;
        this.bleChar = null;
        this.emitStatus();
      });

      if (!device.gatt) {
        throw new Error('Selected device does not expose a GATT server.');
      }

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(NORDIC_UART_SERVICE);
      const characteristic = await service.getCharacteristic(NORDIC_UART_TX_CHAR);

      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (ev: Event) => {
        const target = ev.target as BleCharacteristicLike;
        if (!target.value) return;
        const raw = this.decoder.decode(target.value).trim();
        this.handleRawPayload(raw, 'ble');
      });

      this.bleChar = characteristic;
      this.state.bleStatus = 'connected';
      this.state.bleDeviceName = device.name || 'ESP32 BLE Sensor';
      this.state.bleError = null;
      this.emitStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bluetooth pairing cancelled.';
      this.state.bleStatus = 'error';
      this.state.bleError = message;
      this.emitStatus();
    }
  }

  public disconnectBle(): void {
    if (this.bleDevice?.gatt?.connected) {
      this.bleDevice.gatt.disconnect();
    }
    this.bleDevice = null;
    this.bleChar = null;
    this.state.bleStatus = 'disconnected';
    this.state.bleDeviceName = null;
    this.emitStatus();
  }

  public connectWebSocket(url: string): void {
    const cleanUrl = url.trim();
    if (!cleanUrl) {
      this.state.wsStatus = 'error';
      this.state.wsError = 'Enter a valid WebSocket URL (e.g. ws://192.168.4.1:81).';
      this.emitStatus();
      return;
    }

    this.disconnectWebSocket();
    this.state.wsUrl = cleanUrl;
    this.state.wsStatus = 'connecting';
    this.state.wsError = null;
    this.emitStatus();

    try {
      const socket = new WebSocket(cleanUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.state.wsStatus = 'connected';
        this.state.wsError = null;
        this.emitStatus();
      };

      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          this.handleRawPayload(event.data.trim(), 'websocket');
        }
      };

      socket.onerror = () => {
        this.state.wsStatus = 'error';
        this.state.wsError = 'Could not reach ESP32 WebSocket endpoint.';
        this.emitStatus();
      };

      socket.onclose = () => {
        if (this.state.wsStatus !== 'error') {
          this.state.wsStatus = 'disconnected';
        }
        this.ws = null;
        this.emitStatus();
      };
    } catch (err) {
      this.state.wsStatus = 'error';
      this.state.wsError = err instanceof Error ? err.message : 'WebSocket connection failed.';
      this.emitStatus();
    }
  }

  public disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.state.wsStatus = 'disconnected';
    this.state.wsError = null;
    this.emitStatus();
  }

  private handleRawPayload(raw: string, via: 'ble' | 'websocket'): void {
    const parsed = parseLiveSensorPacket(raw);
    if (!parsed) return;
    this.state.packetCount += 1;
    this.state.lastPacket = raw;
    this.onPacket(parsed, raw, via);
    if (this.state.packetCount % 10 === 1) {
      this.emitStatus();
    }
  }

  public dispose(): void {
    this.disconnectBle();
    this.disconnectWebSocket();
  }
}

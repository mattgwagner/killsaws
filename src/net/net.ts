import { GameSession } from '../game';
export class NetHost { attach(_s: GameSession) {} close() {} }
export class NetGuest { close() {} }

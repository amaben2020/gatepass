import type { Request, Response } from 'express';
import { EventsRepository } from './events.repository.js';
import { SeatsService } from './seats.service.js';
import { WaitingRoomService } from './waiting-room.service.js';

// requireAuth runs first on every route here, so session.userId is always set.
const ids = (req: Request) => ({ eventId: String(req.params.eventId), userId: req.session.userId! });

export class EventsController {
  static async list(_req: Request, res: Response) {
    const rows = await EventsRepository.list();
    res.json({ events: rows.map(({ id, name, startsAt, status }) => ({ id, name, startsAt, status })) });
  }

  static async joinWaitingRoom(req: Request, res: Response) {
    const { eventId, userId } = ids(req);
    res.json(await WaitingRoomService.join(eventId, userId));
  }

  static async waitingRoomStatus(req: Request, res: Response) {
    const { eventId, userId } = ids(req);
    res.json(await WaitingRoomService.status(eventId, userId));
  }

  static async seatMap(req: Request, res: Response) {
    const { eventId, userId } = ids(req);
    res.json(await SeatsService.seatMap(eventId, userId));
  }

  static async holdSeats(req: Request, res: Response) {
    const { eventId, userId } = ids(req);
    res.json(await SeatsService.hold(eventId, userId, req.body?.seatIds));
  }

  static async releaseSeats(req: Request, res: Response) {
    const { eventId, userId } = ids(req);
    await SeatsService.release(eventId, userId);
    res.status(204).end();
  }
}

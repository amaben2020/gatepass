import type { Request, Response } from 'express';
import { OrdersService } from './orders.service.js';

export class OrdersController {
  static async create(req: Request, res: Response) {
    res.status(201).json(await OrdersService.create(String(req.params.eventId), req.session.userId!));
  }

  static async get(req: Request, res: Response) {
    res.json(await OrdersService.get(String(req.params.orderId), req.session.userId!));
  }
}

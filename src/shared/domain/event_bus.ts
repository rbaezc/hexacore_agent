export interface DomainEvent<T = any> {
  eventName: string;
  correlationId: string;
  timestamp: string;
  payload: T;
}

export type EventHandler<T = any> = (event: DomainEvent<T>) => Promise<void> | void;

export class EventBus {
  private static instance: EventBus;
  private handlers = new Map<string, EventHandler[]>();

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  subscribe<T>(eventName: string, handler: EventHandler<T>): void {
    const list = this.handlers.get(eventName) || [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    const list = this.handlers.get(event.eventName) || [];
    for (const handler of list) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Error in event handler for ${event.eventName}:`, err);
      }
    }
  }
}

import { EventBus, DomainEvent } from '../domain/event_bus.js';

export interface TelemetrySpan {
  correlationId: string;
  operationName: string;
  startTime: number;
}

export class TelemetryService {
  constructor(private readonly eventBus: EventBus = EventBus.getInstance()) {}

  startSpan(operationName: string, correlationId: string = `corr_${Date.now()}`): TelemetrySpan {
    return {
      correlationId,
      operationName,
      startTime: Date.now(),
    };
  }

  async endSpan(span: TelemetrySpan, status: 'SUCCESS' | 'FAILURE', metadata?: Record<string, any>): Promise<void> {
    const durationMs = Date.now() - span.startTime;
    const event: DomainEvent = {
      eventName: 'telemetry.span_completed',
      correlationId: span.correlationId,
      timestamp: new Date().toISOString(),
      payload: {
        operationName: span.operationName,
        durationMs,
        status,
        metadata,
      },
    };
    await this.eventBus.publish(event);
  }
}

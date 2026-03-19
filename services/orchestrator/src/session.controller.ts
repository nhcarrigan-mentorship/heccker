import { Controller, Sse, Param } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';
import { ActivityEvent } from '@concaretti/shared-types';

@Controller('sessions')
export class SessionController {
  constructor(private eventEmitter: EventEmitter2) {}

  @Sse(':id/stream')
  streamEvents(@Param('id') id: string): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, `session.${id}`).pipe(
      map((payload: ActivityEvent) => {
        return { data: payload } as MessageEvent;
      }),
    );
  }
}

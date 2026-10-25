import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { AuthController, RateLimiter, SessionGuard } from './auth';
import { ActivitySimulator, HealthController, NotificationsController, PrefsController } from './core';
import { RecordsController } from './records';
import { SearchController } from './search';
import { AiController } from './ai';
import { Activity, Bus, Counts, StreamController } from './realtime';
import {
  AdminsController, AgentsOpsController, AlarmsController, AuditController, CategoriesController, GroupsController,
  ImportController, IncidentsController, MediaController, SecurityAlertsController, UsersOpsController,
} from './ops';

@Module({
  controllers: [
    HealthController, AuthController, PrefsController, NotificationsController, StreamController, RecordsController, SearchController, AiController,
    UsersOpsController, AgentsOpsController, GroupsController, CategoriesController, AdminsController, IncidentsController, MediaController,
    AlarmsController, SecurityAlertsController, AuditController, ImportController,
  ],
  providers: [PrismaService, Bus, Counts, Activity, RateLimiter, ActivitySimulator, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}

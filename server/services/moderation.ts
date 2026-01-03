import { storage as globalStorage, type IStorage } from '../storage';
import { labelService as globalLabelService, type LabelService } from './label';
import type {
  InsertModerationReport,
  ModerationReport,
  InsertModerationAction,
  ModerationAction,
  InsertModeratorAssignment,
  ModeratorAssignment,
} from '@shared/schema';

export class ModerationService {
  private readonly storage: IStorage;
  private readonly labelService: LabelService;

  /**
   * Create a ModerationService instance
   * @param storage - Storage instance for persistence (defaults to global singleton)
   * @param labelService - LabelService instance (defaults to global singleton)
   */
  constructor(storage?: IStorage, labelService?: LabelService) {
    this.storage = storage ?? globalStorage;
    this.labelService = labelService ?? globalLabelService;
  }
  async createReport(params: {
    subject: string;
    subjectType: 'post' | 'account' | 'message';
    reportType:
      | 'spam'
      | 'violation'
      | 'misleading'
      | 'sexual'
      | 'rude'
      | 'other';
    reason?: string;
    reporterDid: string;
  }): Promise<ModerationReport> {
    const report: InsertModerationReport = {
      subject: params.subject,
      subjectType: params.subjectType,
      reportType: params.reportType,
      reason: params.reason,
      reporterDid: params.reporterDid,
      status: 'pending',
    };

    const createdReport = await this.storage.createModerationReport(report);

    await this.checkAutomatedEscalation(createdReport);

    return createdReport;
  }

  async getReport(id: number): Promise<ModerationReport | undefined> {
    return await this.storage.getModerationReport(id);
  }

  async getReportsByStatus(
    status: string,
    limit?: number
  ): Promise<ModerationReport[]> {
    return await this.storage.getModerationReportsByStatus(status, limit);
  }

  async getPendingReports(limit = 50): Promise<ModerationReport[]> {
    return await this.getReportsByStatus('pending', limit);
  }

  async getReviewQueue(limit = 50): Promise<ModerationReport[]> {
    return await this.getReportsByStatus('under_review', limit);
  }

  async assignModerator(
    reportId: number,
    moderatorDid: string
  ): Promise<ModeratorAssignment> {
    await this.storage.updateModerationReportStatus(reportId, 'under_review');

    const assignment: InsertModeratorAssignment = {
      reportId,
      moderatorDid,
    };

    return await this.storage.assignModerator(assignment);
  }

  async takeAction(params: {
    reportId: number;
    actionType:
      | 'label_applied'
      | 'content_removed'
      | 'account_suspended'
      | 'dismissed'
      | 'escalated';
    moderatorDid: string;
    resolutionNotes?: string;
    labelValue?: string;
    labelSrc?: string;
  }): Promise<ModerationAction> {
    const report = await this.storage.getModerationReport(params.reportId);
    if (!report) {
      throw new Error(`Report ${params.reportId} not found`);
    }

    let labelUri: string | undefined;

    if (
      params.actionType === 'label_applied' &&
      params.labelValue &&
      params.labelSrc
    ) {
      const label = await this.labelService.applyLabel({
        src: params.labelSrc,
        subject: report.subject,
        val: params.labelValue,
      });
      labelUri = label.uri;
    }

    const action: InsertModerationAction = {
      reportId: params.reportId,
      actionType: params.actionType,
      moderatorDid: params.moderatorDid,
      resolutionNotes: params.resolutionNotes,
      labelUri,
    };

    const createdAction = await this.storage.createModerationAction(action);

    // Map action type to correct terminal status
    if (params.actionType !== 'escalated') {
      const statusMap: Record<string, string> = {
        dismissed: 'dismissed',
        label_applied: 'resolved',
        content_removed: 'resolved',
        account_suspended: 'resolved',
      };
      const newStatus = statusMap[params.actionType] || 'resolved';
      await this.storage.updateModerationReportStatus(params.reportId, newStatus);
    }

    const assignments = await this.storage.getModeratorAssignmentsByReport(
      params.reportId
    );
    for (const assignment of assignments) {
      if (!assignment.completedAt) {
        await this.storage.completeModeratorAssignment(assignment.id);
      }
    }

    return createdAction;
  }

  async dismissReport(
    reportId: number,
    moderatorDid: string,
    reason?: string
  ): Promise<ModerationAction> {
    return await this.takeAction({
      reportId,
      actionType: 'dismissed',
      moderatorDid,
      resolutionNotes: reason,
    });
  }

  async escalateReport(
    reportId: number,
    moderatorDid: string,
    reason?: string
  ): Promise<ModerationAction> {
    await this.storage.updateModerationReportStatus(reportId, 'under_review');

    return await this.takeAction({
      reportId,
      actionType: 'escalated',
      moderatorDid,
      resolutionNotes: reason,
    });
  }

  async getReportHistory(reportId: number): Promise<{
    report: ModerationReport | undefined;
    actions: ModerationAction[];
    assignments: ModeratorAssignment[];
  }> {
    const report = await this.storage.getModerationReport(reportId);
    const actions = await this.storage.getModerationActionsByReport(reportId);
    const assignments = await this.storage.getModeratorAssignmentsByReport(reportId);

    return { report, actions, assignments };
  }

  async getModeratorWorkload(moderatorDid: string): Promise<{
    activeAssignments: ModeratorAssignment[];
    totalActions: ModerationAction[];
  }> {
    const activeAssignments = await this.storage.getModeratorAssignmentsByModerator(
      moderatorDid,
      false, // Don't include completed
      100
    );

    const totalActions = await this.storage.getModerationActionsByModerator(
      moderatorDid,
      100
    );

    return { activeAssignments, totalActions };
  }

  private async checkAutomatedEscalation(
    report: ModerationReport
  ): Promise<void> {
    const existingReports = await this.storage.getModerationReportsBySubject(
      report.subject
    );

    const pendingOrReviewCount = existingReports.filter(
      (r) => r.status === 'pending' || r.status === 'under_review'
    ).length;

    if (pendingOrReviewCount >= 3) {
      await this.storage.updateModerationReportStatus(report.id, 'under_review');

      const spamLikeTypes = ['spam', 'violation'];
      if (spamLikeTypes.includes(report.reportType)) {
        await this.labelService.applyLabel({
          src: 'did:plc:system',
          subject: report.subject,
          val: '!warn',
        });
      }

      console.log(
        `[MODERATION] Auto-escalated report ${report.id} - ${pendingOrReviewCount} reports for subject ${report.subject}`
      );
    }
  }
}

/**
 * Global singleton instance (for backwards compatibility)
 * @deprecated Prefer using createModerationService() with DI
 */
export const moderationService = new ModerationService();

/**
 * Factory function for creating ModerationService with dependency injection
 * @param storage - Storage instance to use for persistence
 * @param labelService - LabelService instance for applying labels
 */
export function createModerationService(
  storage: IStorage,
  labelService: LabelService
): ModerationService {
  return new ModerationService(storage, labelService);
}

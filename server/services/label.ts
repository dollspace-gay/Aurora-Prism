import { storage as globalStorage, type IStorage } from '../storage';
import type {
  InsertLabel,
  Label,
  InsertLabelDefinition,
  LabelDefinition,
} from '@shared/schema';
import { EventEmitter } from 'events';

export class LabelService extends EventEmitter {
  private readonly storage: IStorage;

  /**
   * Create a LabelService instance
   * @param storage - Storage instance for persistence (defaults to global singleton)
   */
  constructor(storage?: IStorage) {
    super();
    this.storage = storage ?? globalStorage;
  }
  async applyLabel(params: {
    src: string;
    subject: string;
    val: string;
    neg?: boolean;
    createdAt?: Date;
  }): Promise<Label> {
    const uri = `at://${params.src}/app.bsky.labeler.label/${Date.now()}`;

    const label: InsertLabel = {
      uri,
      src: params.src,
      subject: params.subject,
      val: params.val,
      neg: params.neg || false,
      createdAt: params.createdAt || new Date(),
    };

    const createdLabel = await this.storage.createLabel(label);

    const event = await this.storage.createLabelEvent({
      labelUri: uri,
      action: 'created',
    });

    // Emit label created event for real-time broadcasting
    this.emit('labelCreated', { label: createdLabel, event });

    return createdLabel;
  }

  async negateLabel(params: {
    src: string;
    subject: string;
    val: string;
  }): Promise<Label> {
    return this.applyLabel({
      ...params,
      neg: true,
    });
  }

  async removeLabel(uri: string): Promise<void> {
    const label = await this.storage.getLabel(uri);

    const event = await this.storage.createLabelEvent({
      labelUri: uri,
      action: 'deleted',
    });

    await this.storage.deleteLabel(uri);

    // Emit label removed event for real-time broadcasting
    if (label) {
      this.emit('labelRemoved', { label, event });
    }
  }

  async getLabelsForSubject(subject: string): Promise<Label[]> {
    return await this.storage.getLabelsForSubject(subject);
  }

  async getLabelsForSubjects(
    subjects: string[]
  ): Promise<Map<string, Label[]>> {
    const allLabels = await this.storage.getLabelsForSubjects(subjects);
    const labelMap = new Map<string, Label[]>();

    for (const label of allLabels) {
      const existing = labelMap.get(label.subject) || [];
      existing.push(label);
      labelMap.set(label.subject, existing);
    }

    return labelMap;
  }

  async queryLabels(params: {
    sources?: string[];
    subjects?: string[];
    values?: string[];
    limit?: number;
  }): Promise<Label[]> {
    return await this.storage.queryLabels(params);
  }

  async getActiveLabelsForSubject(subject: string): Promise<Label[]> {
    const labels = await this.storage.getLabelsForSubject(subject);
    return this.filterNegatedLabels(labels);
  }

  async getActiveLabelsForSubjects(
    subjects: string[]
  ): Promise<Map<string, Label[]>> {
    const allLabels = await this.storage.getLabelsForSubjects(subjects);
    const labelMap = new Map<string, Label[]>();

    for (const label of allLabels) {
      const existing = labelMap.get(label.subject) || [];
      existing.push(label);
      labelMap.set(label.subject, existing);
    }

    const result = new Map<string, Label[]>();
    for (const [subject, labels] of Array.from(labelMap.entries())) {
      result.set(subject, this.filterNegatedLabels(labels));
    }

    return result;
  }

  async createLabelDefinition(params: {
    value: string;
    description?: string;
    severity?: 'info' | 'warn' | 'alert' | 'none';
    localizedStrings?: Record<string, any>;
  }): Promise<LabelDefinition> {
    const definition: InsertLabelDefinition = {
      value: params.value,
      description: params.description,
      severity: params.severity || 'warn',
      localizedStrings: params.localizedStrings || {},
    };

    return await this.storage.createLabelDefinition(definition);
  }

  async getLabelDefinition(
    value: string
  ): Promise<LabelDefinition | undefined> {
    return await this.storage.getLabelDefinition(value);
  }

  async getAllLabelDefinitions(): Promise<LabelDefinition[]> {
    return await this.storage.getAllLabelDefinitions();
  }

  async updateLabelDefinition(
    value: string,
    data: Partial<InsertLabelDefinition>
  ): Promise<LabelDefinition | undefined> {
    return await this.storage.updateLabelDefinition(value, data);
  }

  async getRecentLabelEvents(limit = 100, since?: Date) {
    return await this.storage.getRecentLabelEvents(limit, since);
  }

  private filterNegatedLabels(labels: Label[]): Label[] {
    const labelMap = new Map<string, Label>();

    for (const label of labels.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )) {
      const key = `${label.subject}:${label.val}`;

      if (label.neg) {
        labelMap.delete(key);
      } else {
        labelMap.set(key, label);
      }
    }

    return Array.from(labelMap.values());
  }
}

/**
 * Global singleton instance (for backwards compatibility)
 * @deprecated Prefer using createLabelService() with DI
 */
export const labelService = new LabelService();

/**
 * Factory function for creating LabelService with dependency injection
 * @param storage - Storage instance to use for persistence
 */
export function createLabelService(storage: IStorage): LabelService {
  return new LabelService(storage);
}

import { taskBody, taskCount } from '../../core/templates.ts';
import type { Template, TemplateDate } from '../../core/types.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { repeatLabel } from '../repeat/repeatText.ts';

/** A template's line under its name: "3 subtasks, Weekly" or "12 tasks". */
export function templateSummary(template: Template, today: string): string {
  if (template.kind === 'list') {
    return t('templates.taskCount', { count: taskCount(template) });
  }
  const body = taskBody(template);
  if (!body) return '';
  const parts: string[] = [];
  const subtasks = taskCount(template);
  if (subtasks > 0) parts.push(t('templates.subtaskCount', { count: subtasks }));
  if (body.recurrence) parts.push(repeatLabel(body.recurrence, today));
  if (body.due) parts.push(t('templates.dueIn', { when: relativeDay(body.due) }));
  else if (body.start) parts.push(t('templates.startsIn', { when: relativeDay(body.start) }));
  return parts.join(', ') || t('templates.oneTask');
}

/** A template date in words, counted from the day it is used: "Today", "In 3 days, 9:00". */
export function relativeDay(date: TemplateDate): string {
  const day = t('templates.inDays', { count: date.inDays });
  return date.time ? t('templates.dayAtTime', { day, time: formatTime(date.time) }) : day;
}

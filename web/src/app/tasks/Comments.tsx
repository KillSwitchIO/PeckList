import SendRounded from '@mui/icons-material/SendRounded';
import {
  Box,
  Button,
  IconButton,
  InputBase,
  Link,
  Menu,
  MenuItem,
  MenuList,
  Paper,
  Typography,
} from '@mui/material';
import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import {
  addComment,
  canChangeComment,
  canComment,
  commentsOf,
  deleteComment,
  editComment,
  mentionAt,
  mentionCandidates,
  mentionName,
} from '../../core/comments.ts';
import { commentParagraphs, type Inline } from '../../core/commentText.ts';
import { getEntity } from '../../core/collections.ts';
import type { Comment, Task, User } from '../../core/types.ts';
import { formatWhen } from '../format.ts';
import { Avatar } from '../friends/Avatar.tsx';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { MoreIcon } from '../icons/icons.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';

function Tokens({ tokens }: { tokens: Inline[] }): ReactNode {
  return tokens.map((token, index) => {
    switch (token.kind) {
      case 'text':
        return <Fragment key={index}>{token.text}</Fragment>;
      case 'break':
        return <br key={index} />;
      case 'bold':
        return (
          <strong key={index}>
            <Tokens tokens={token.children} />
          </strong>
        );
      case 'italic':
        return (
          <em key={index}>
            <Tokens tokens={token.children} />
          </em>
        );
      case 'code':
        return (
          <Box
            key={index}
            component="code"
            sx={{ px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover', fontSize: '0.85em' }}
          >
            {token.text}
          </Box>
        );
      case 'link':
        return (
          <Link key={index} href={token.href} target="_blank" rel="noopener noreferrer">
            {token.text}
          </Link>
        );
      case 'mention':
        return (
          <Box key={index} component="span" sx={{ color: 'primary.main', fontWeight: 500 }}>
            @{token.name}
          </Box>
        );
    }
  });
}

/** A comment's text: its small markdown, never HTML. */
export function CommentBody({ body }: { body: string }) {
  return commentParagraphs(body).map((paragraph, index) => (
    <Typography
      key={index}
      variant="body2"
      sx={{ mt: index === 0 ? 0 : 1, wordBreak: 'break-word' }}
    >
      <Tokens tokens={paragraph} />
    </Typography>
  ));
}

/**
 * Where a comment is written: a growing text field that posts on Ctrl+Enter (or the send button),
 * suggesting the people on the task after an @.
 */
function Composer({
  initial = '',
  people,
  label,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  people: User[];
  label: string;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [pick, setPick] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const typing = mentionAt(text, caret);
  const query = typing?.query.toLowerCase() ?? '';
  const matches = typing
    ? people
        .filter(
          (person) =>
            mentionName(person).toLowerCase().startsWith(query) ||
            person.displayName.toLowerCase().startsWith(query),
        )
        .slice(0, 6)
    : [];

  const choose = (person: User) => {
    if (!typing) return;
    const name = `@${mentionName(person)} `;
    const next = text.slice(0, typing.start) + name + text.slice(caret);
    const at = typing.start + name.length;
    setText(next);
    setCaret(at);
    requestAnimationFrame(() => field.current?.setSelectionRange(at, at));
  };
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text);
    setText('');
    setCaret(0);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setPick(
          (current) =>
            (current + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(matches[Math.min(pick, matches.length - 1)]!);
        return;
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && onCancel) {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0.5,
          px: 1.5,
          py: 0.5,
          borderRadius: 2,
          bgcolor: 'action.hover',
        }}
      >
        <InputBase
          inputRef={field}
          multiline
          maxRows={8}
          fullWidth
          value={text}
          placeholder={label}
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setPick(0);
          }}
          onSelect={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          inputProps={{ 'aria-label': label, maxLength: 20000 }}
          sx={{ py: 0.75, typography: 'body2' }}
          autoFocus={initial !== ''}
        />
        {onCancel && (
          <Button size="small" onClick={onCancel} sx={{ mb: 0.25 }}>
            {t('common.cancel')}
          </Button>
        )}
        <IconButton
          size="small"
          aria-label={submitLabel}
          title={`${submitLabel} (Ctrl+Enter)`}
          disabled={!text.trim()}
          onClick={submit}
          sx={{ mb: 0.25 }}
        >
          <SendRounded fontSize="small" />
        </IconButton>
      </Box>
      {matches.length > 0 && (
        <Paper
          elevation={4}
          sx={{ position: 'absolute', left: 8, bottom: '100%', mb: 0.5, zIndex: 2, minWidth: 200 }}
        >
          <MenuList dense aria-label={t('comments.people')}>
            {matches.map((person, index) => (
              <MenuItem
                key={person.id}
                selected={index === Math.min(pick, matches.length - 1)}
                // Keep the focus in the text while choosing with the mouse.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
              >
                <Avatar name={person.displayName} color={person.avatarColor} size={20} />
                <Box component="span" sx={{ ml: 1 }}>
                  {person.displayName}
                </Box>
                <Box component="span" sx={{ ml: 1, color: 'text.secondary' }}>
                  @{mentionName(person)}
                </Box>
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      )}
    </Box>
  );
}

function CommentRow({ comment, people }: { comment: Comment; people: User[] }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const today = useToday();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const author = getEntity(workspace, 'users', comment.createdBy);
  const name =
    comment.createdBy === me ? t('comments.you') : (author?.displayName ?? t('comments.someone'));
  const may = canChangeComment(workspace, me, comment);
  const when = formatWhen(localDateTimeOf(comment.createdAt, localTimeZone()), today);

  return (
    <Box
      component="li"
      aria-label={t('comments.by', { name })}
      sx={{ display: 'flex', gap: 1.25, py: 1 }}
    >
      <Avatar
        name={author?.displayName ?? name}
        color={author?.avatarColor ?? '#B8BCC4'}
        size={28}
      />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
            {when}
            {comment.editedAt && ` · ${t('comments.edited')}`}
          </Typography>
          {(may.edit || may.delete) && !editing && (
            <IconButton
              size="small"
              aria-label={t('comments.actions', { name })}
              onClick={(event) => setMenu(event.currentTarget)}
              sx={{ my: -0.5 }}
            >
              <MoreIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
        {editing ? (
          <Box sx={{ mt: 0.5 }}>
            <Composer
              initial={comment.body}
              people={people}
              label={t('comments.edit')}
              submitLabel={t('common.save')}
              onCancel={() => setEditing(false)}
              onSubmit={(body) => {
                apply((ctx, ws) => editComment(ctx, ws, comment.id, body));
                setEditing(false);
              }}
            />
          </Box>
        ) : (
          <CommentBody body={comment.body} />
        )}
      </Box>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        {may.edit && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setEditing(true);
            }}
          >
            {t('comments.editAction')}
          </MenuItem>
        )}
        {may.delete && (
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={() => {
              setMenu(null);
              apply((ctx, ws) => deleteComment(ctx, ws, comment.id), t('undo.commentDeleted'));
            }}
          >
            {t('comments.delete')}
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}

/** A task's comments, oldest first, and a box to add one (spec: PL-050). */
export function Comments({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const comments = commentsOf(workspace, task.id);
  const allowed = canComment(workspace, me, task);
  if (!allowed && comments.length === 0) return null;
  const people = mentionCandidates(workspace, me, task);

  return (
    <Box component="section" aria-label={t('comments.title')}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
        {comments.length > 0
          ? t('comments.titleCount', { count: comments.length })
          : t('comments.title')}
      </Typography>
      {comments.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mb: 1 }}>
          {comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} people={people} />
          ))}
        </Box>
      )}
      {allowed && (
        <Composer
          people={people}
          label={t('comments.add')}
          submitLabel={t('comments.post')}
          onSubmit={(body) => apply((ctx, ws) => addComment(ctx, ws, task.id, body).workspace)}
        />
      )}
    </Box>
  );
}

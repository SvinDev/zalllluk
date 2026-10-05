import { useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Rate,
  Row,
  Select,
  Skeleton,
  Tag,
  Timeline,
  Typography,
} from 'antd'
import { useState } from 'react'
import { useParams } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { TicketDetail, TicketStatus } from '@/api/types'
import { MANAGERS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { StatusTag } from '@/components/StatusTag'
import { UserSelect } from '@/components/selects'
import { dateTime } from '@/lib/format'
import { options, ticketCategoryLabels, ticketPriorities, ticketStatuses } from '@/lib/labels'

// Те же переходы, что и на сервере (app/tickets/service.py) — для отображения кнопок.
const STAFF_ACTIONS: Partial<Record<TicketStatus, TicketStatus[]>> = {
  new: ['in_progress', 'waiting', 'resolved', 'rejected'],
  in_progress: ['waiting', 'resolved', 'rejected'],
  waiting: ['in_progress', 'resolved', 'rejected'],
  resolved: ['closed', 'in_progress'],
}
const RESIDENT_ACTIONS: Partial<Record<TicketStatus, TicketStatus[]>> = {
  new: ['closed'],
  resolved: ['closed', 'in_progress'],
}
const ACTION_LABELS: Partial<Record<TicketStatus, string>> = {
  in_progress: 'В работу',
  waiting: 'Ожидание',
  resolved: 'Выполнена',
  rejected: 'Отклонить',
  closed: 'Закрыть',
}

export default function TicketPage() {
  const id = Number(useParams().id)
  const { user, hasRole } = useAuth()
  const isStaff = user?.role !== 'resident'
  const isManager = hasRole(...MANAGERS)
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [internal, setInternal] = useState(false)
  const [transition, setTransition] = useState<TicketStatus | null>(null)
  const [transitionComment, setTransitionComment] = useState('')
  const [rating, setRating] = useState(5)
  const [ratingComment, setRatingComment] = useState('')

  const path = { params: { path: { ticket_id: id } } }
  const { data, isLoading, error } = api.useQuery('get', '/api/v1/tickets/{ticket_id}', path)
  const setStatus = api.useMutation('post', '/api/v1/tickets/{ticket_id}/status')
  const addComment = api.useMutation('post', '/api/v1/tickets/{ticket_id}/comments')
  const update = api.useMutation('patch', '/api/v1/tickets/{ticket_id}')
  const rate = api.useMutation('post', '/api/v1/tickets/{ticket_id}/rate')

  const apply = (ticket: TicketDetail) => {
    queryClient.setQueryData(['get', '/api/v1/tickets/{ticket_id}', path], ticket)
    void queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/tickets'] })
  }
  const run = async (action: () => Promise<TicketDetail>) => {
    try {
      apply(await action())
      return true
    } catch (e) {
      message.error(errorMessage(e))
      return false
    }
  }

  if (isLoading) return <Skeleton active />
  if (error || !data) return <QueryError error={error} />
  const t = data
  const actions = (isStaff ? STAFF_ACTIONS : RESIDENT_ACTIONS)[t.status] ?? []
  const closed = t.status === 'closed' || t.status === 'rejected'
  const canRate = user?.role === 'resident' && (t.status === 'resolved' || t.status === 'closed') && t.rating === null

  return (
    <>
      <PageHeader
        title={`Заявка №${t.id}: ${t.subject}`}
        subtitle={
          <Flex gap={6} wrap>
            <StatusTag value={t.status} map={ticketStatuses} />
            <StatusTag value={t.priority} map={ticketPriorities} />
            {t.is_overdue && <Tag color="red">просрочена</Tag>}
          </Flex>
        }
        extra={actions.map((status) => (
          <Button
            key={status}
            type={status === 'resolved' || status === 'in_progress' ? 'primary' : 'default'}
            danger={status === 'rejected'}
            onClick={() => { setTransition(status); setTransitionComment('') }}
          >
            {user?.role === 'resident' && status === 'closed' && t.status === 'new'
              ? 'Отозвать'
              : user?.role === 'resident' && status === 'in_progress'
                ? 'Не выполнено — вернуть'
                : ACTION_LABELS[status]}
          </Button>
        ))}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="Описание">
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{t.description}</Typography.Paragraph>
          </Card>
          <Card title="История и переписка" style={{ marginTop: 16 }}>
            {t.comments.length === 0 ? (
              <Empty description="Пока нет комментариев" />
            ) : (
              <Timeline
                items={t.comments.map((c) => ({
                  color: c.is_system ? 'gray' : c.is_internal ? 'orange' : 'blue',
                  children: (
                    <>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {dateTime(c.created_at)} · {c.author?.full_name ?? 'система'}
                        {c.is_internal && <Tag color="orange" style={{ marginLeft: 8 }}>внутренний</Tag>}
                      </Typography.Text>
                      <div style={{ whiteSpace: 'pre-wrap', fontStyle: c.is_system ? 'italic' : undefined }}>{c.body}</div>
                    </>
                  ),
                }))}
              />
            )}
            {!closed && (
              <>
                <Divider />
                <Input.TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий" maxLength={10000} />
                <Flex justify="space-between" align="center" style={{ marginTop: 8 }}>
                  {isStaff ? (
                    <Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)}>Внутренний (не виден жителю)</Checkbox>
                  ) : (
                    <span />
                  )}
                  <Button
                    type="primary"
                    disabled={!comment.trim()}
                    loading={addComment.isPending}
                    onClick={async () => {
                      const ok = await run(() => addComment.mutateAsync({ ...path, body: { body: comment, is_internal: internal } }))
                      if (ok) setComment('')
                    }}
                  >
                    Отправить
                  </Button>
                </Flex>
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Адрес">
                {t.building.address}
                {t.apartment ? `, кв. ${t.apartment.number}` : ''}
              </Descriptions.Item>
              <Descriptions.Item label="Категория">{ticketCategoryLabels[t.category]}</Descriptions.Item>
              <Descriptions.Item label="Автор">{t.author?.full_name ?? '—'}</Descriptions.Item>
              {isStaff && t.author?.phone && <Descriptions.Item label="Телефон">{t.author.phone}</Descriptions.Item>}
              <Descriptions.Item label="Создана">{dateTime(t.created_at)}</Descriptions.Item>
              <Descriptions.Item label="Срок">{dateTime(t.due_at)}</Descriptions.Item>
              {t.resolved_at && <Descriptions.Item label="Выполнена">{dateTime(t.resolved_at)}</Descriptions.Item>}
              <Descriptions.Item label="Исполнитель">{t.assignee?.full_name ?? '—'}</Descriptions.Item>
              {t.rating && (
                <Descriptions.Item label="Оценка">
                  <Rate disabled value={t.rating} style={{ fontSize: 14 }} />
                </Descriptions.Item>
              )}
            </Descriptions>
            {t.rating_comment && <Typography.Paragraph type="secondary">«{t.rating_comment}»</Typography.Paragraph>}
          </Card>
          {isManager && !closed && (
            <Card title="Управление" style={{ marginTop: 16 }}>
              <Form layout="vertical">
                <Form.Item label="Исполнитель">
                  <UserSelect
                    value={t.assignee?.id}
                    placeholder="Назначить сотрудника"
                    onChange={(value) => run(() => update.mutateAsync({ ...path, body: { assignee_id: value ?? null } }))}
                  />
                </Form.Item>
                <Form.Item label="Приоритет">
                  <Select value={t.priority} options={options(ticketPriorities)} onChange={(value) => run(() => update.mutateAsync({ ...path, body: { priority: value } }))} />
                </Form.Item>
                <Form.Item label="Категория" style={{ marginBottom: 0 }}>
                  <Select value={t.category} options={options(ticketCategoryLabels)} onChange={(value) => run(() => update.mutateAsync({ ...path, body: { category: value } }))} />
                </Form.Item>
              </Form>
            </Card>
          )}
          {canRate && (
            <Card title="Оцените выполнение" style={{ marginTop: 16 }}>
              <Rate value={rating} onChange={setRating} />
              <Input.TextArea rows={2} style={{ marginTop: 8 }} placeholder="Отзыв (необязательно)" value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} />
              <Button
                type="primary"
                style={{ marginTop: 8 }}
                loading={rate.isPending}
                onClick={() => run(() => rate.mutateAsync({ ...path, body: { rating, comment: ratingComment || undefined } }))}
              >
                Оценить
              </Button>
            </Card>
          )}
        </Col>
      </Row>
      <Modal
        open={transition !== null}
        title={transition ? `${ACTION_LABELS[transition]}?` : ''}
        okText="Подтвердить"
        confirmLoading={setStatus.isPending}
        okButtonProps={{ disabled: transition === 'rejected' && !transitionComment.trim() }}
        onCancel={() => setTransition(null)}
        onOk={async () => {
          if (!transition) return
          const ok = await run(() =>
            setStatus.mutateAsync({ ...path, body: { status: transition, comment: transitionComment || undefined } }),
          )
          if (ok) setTransition(null)
        }}
      >
        <Input.TextArea
          rows={3}
          value={transitionComment}
          onChange={(e) => setTransitionComment(e.target.value)}
          placeholder={transition === 'rejected' ? 'Причина отклонения (обязательно)' : 'Комментарий (необязательно)'}
        />
      </Modal>
    </>
  )
}

import { CarOutlined, CheckCircleFilled, CloseCircleFilled, LoginOutlined, NumberOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Col, Empty, Flex, Input, List, Row, Segmented, Space, Tag, Typography } from 'antd'
import { useState } from 'react'

import { api, fetchClient } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { PassCheckResult } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { StatusTag } from '@/components/StatusTag'
import { dateTime } from '@/lib/format'
import { passKindLabels, passStatuses } from '@/lib/labels'

type Mode = 'code' | 'plate'

export default function GuardPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('code')
  const [value, setValue] = useState('')
  const [results, setResults] = useState<PassCheckResult[] | null>(null)
  const [checking, setChecking] = useState(false)
  const visit = api.useMutation('post', '/api/v1/passes/{pass_id}/visits')
  const active = api.useQuery('get', '/api/v1/passes', { params: { query: { active_now: true, limit: 50 } } })

  const check = async (query = value, by: Mode = mode) => {
    if (!query.trim()) return
    setChecking(true)
    const { data, error } = await fetchClient.GET('/api/v1/passes/check', {
      params: { query: by === 'code' ? { code: query.trim() } : { plate: query.trim() } },
    })
    setChecking(false)
    if (error) {
      message.error(errorMessage(error))
      return
    }
    setResults(data)
  }

  const letIn = async (pass: PassCheckResult) => {
    try {
      await visit.mutateAsync({ params: { path: { pass_id: pass.id } }, body: {} })
      message.success('Проход отмечен')
      await check()
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/passes'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader title="Пост охраны" subtitle="Проверка пропуска по коду или госномеру" />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card>
            <Segmented<Mode>
              block
              size="large"
              value={mode}
              onChange={(m) => { setMode(m); setResults(null); setValue('') }}
              options={[
                { value: 'code', label: 'Код пропуска', icon: <NumberOutlined /> },
                { value: 'plate', label: 'Госномер', icon: <CarOutlined /> },
              ]}
            />
            <Input.Search
              style={{ marginTop: 16 }}
              size="large"
              autoFocus
              enterButton="Проверить"
              placeholder={mode === 'code' ? 'Например, GST7K2' : 'Например, А123ВС777'}
              value={value}
              loading={checking}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              onSearch={(v) => check(v)}
            />
            {results !== null && (
              <div style={{ marginTop: 16 }}>
                {results.length === 0 ? (
                  <Alert type="error" showIcon message="Пропуск не найден" description="Проверьте код или номер, свяжитесь с жителем." />
                ) : (
                  <Flex vertical gap={12}>
                    {results.map((p) => (
                      <Card
                        key={p.id}
                        size="small"
                        style={{ borderColor: p.valid_now ? '#52c41a' : '#ff4d4f', borderWidth: 2 }}
                      >
                        <Flex justify="space-between" align="flex-start" wrap gap={12}>
                          <Space direction="vertical" size={2}>
                            <Space>
                              {p.valid_now ? (
                                <CheckCircleFilled style={{ color: '#52c41a', fontSize: 24 }} />
                              ) : (
                                <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 24 }} />
                              )}
                              <Typography.Title level={4} style={{ margin: 0 }}>
                                {p.valid_now ? 'Можно пропустить' : 'Не действует'}
                              </Typography.Title>
                            </Space>
                            {p.reason && <Typography.Text type="danger">{p.reason}</Typography.Text>}
                            <Typography.Text>
                              {passKindLabels[p.kind]}: <strong>{[p.visitor_name, p.vehicle_plate].filter(Boolean).join(' · ') || 'без имени'}</strong>
                            </Typography.Text>
                            <Typography.Text>
                              К: {p.apartment.building.address}, кв. {p.apartment.number}
                            </Typography.Text>
                            <Typography.Text type="secondary">
                              {dateTime(p.valid_from)} — {dateTime(p.valid_until)} · {p.is_one_time ? 'разовый' : 'многоразовый'}
                            </Typography.Text>
                            {p.comment && <Typography.Text type="secondary">Комментарий: {p.comment}</Typography.Text>}
                            {p.visits.length > 0 && (
                              <Typography.Text type="secondary">
                                Проходов: {p.visits.length}, последний {dateTime(p.visits[p.visits.length - 1].entered_at)}
                              </Typography.Text>
                            )}
                          </Space>
                          <Flex vertical align="flex-end" gap={8}>
                            <Tag style={{ fontSize: 16, padding: '4px 10px' }}>{p.code}</Tag>
                            <StatusTag value={p.status} map={passStatuses} />
                            {p.valid_now && (
                              <Button type="primary" size="large" icon={<LoginOutlined />} loading={visit.isPending} onClick={() => letIn(p)}>
                                Отметить проход
                              </Button>
                            )}
                          </Flex>
                        </Flex>
                      </Card>
                    ))}
                  </Flex>
                )}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title={`Действуют сейчас (${active.data?.total ?? 0})`}>
            <List
              loading={active.isLoading}
              locale={{ emptyText: <Empty description="Нет действующих пропусков" /> }}
              dataSource={active.data?.items ?? []}
              renderItem={(p) => (
                <List.Item
                  onClick={() => { setMode('code'); setValue(p.code); void check(p.code, 'code') }}
                  style={{ cursor: 'pointer' }}
                  extra={<Tag>{p.code}</Tag>}
                >
                  <List.Item.Meta
                    title={[p.visitor_name, p.vehicle_plate].filter(Boolean).join(' · ') || passKindLabels[p.kind]}
                    description={`${p.apartment.building.address}, кв. ${p.apartment.number} · до ${dateTime(p.valid_until)}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </>
  )
}

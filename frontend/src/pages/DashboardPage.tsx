import { Card, Col, Empty, Flex, Progress, Row, Skeleton, Statistic, Table, Tag, Typography } from 'antd'
import { Link } from 'react-router'

import { api } from '@/api/client'
import type { Dashboard } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { money, period } from '@/lib/format'
import { ticketCategoryLabels } from '@/lib/labels'

function BillingChart({ history }: { history: Dashboard['billing']['history'] }) {
  const max = Math.max(1, ...history.flatMap((m) => [Number(m.charged), Number(m.paid)]))
  return (
    <Flex gap={12} align="flex-end" style={{ height: 180, paddingTop: 8 }}>
      {history.map((month) => (
        <Flex key={month.period} vertical align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Flex gap={4} align="flex-end" style={{ height: 140 }}>
            {(['charged', 'paid'] as const).map((key) => (
              <div
                key={key}
                title={`${key === 'charged' ? 'Начислено' : 'Оплачено'}: ${money(month[key])}`}
                style={{
                  width: 14,
                  height: `${(Number(month[key]) / max) * 100}%`,
                  minHeight: 2,
                  borderRadius: 3,
                  background: key === 'charged' ? '#1677ff' : '#52c41a',
                }}
              />
            ))}
          </Flex>
          <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {period(month.period).split(' ')[0].slice(0, 3)}
          </Typography.Text>
        </Flex>
      ))}
    </Flex>
  )
}

export default function DashboardPage() {
  const { data, error, isLoading } = api.useQuery('get', '/api/v1/dashboard')

  if (isLoading) return <Skeleton active paragraph={{ rows: 10 }} />
  if (error || !data) return <QueryError error={error} />

  const coverage = data.readings.active_meters
    ? Math.round((data.readings.meters_with_readings / data.readings.active_meters) * 100)
    : 0
  const categories = Object.entries(data.tickets.by_category).sort((a, b) => b[1] - a[1])

  return (
    <>
      <PageHeader title="Сводка" subtitle={`${data.buildings} домов · ${data.apartments} помещений · ${data.residents} жителей в кабинете`} />
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card>
            <Link to="/tickets?only_open=1">
              <Statistic title="Открытые заявки" value={data.tickets.open} />
            </Link>
            <Flex gap={4} wrap style={{ marginTop: 8 }}>
              {data.tickets.emergency > 0 && <Tag color="red">аварийных: {data.tickets.emergency}</Tag>}
              {data.tickets.overdue > 0 && <Tag color="orange">просрочено: {data.tickets.overdue}</Tag>}
              <Tag>новых: {data.tickets.new}</Tag>
            </Flex>
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Link to="/debtors">
              <Statistic title="Общий долг" value={money(data.billing.total_debt)} valueStyle={{ color: '#cf1322' }} />
            </Link>
            <Typography.Text type="secondary">должников: {data.billing.debtors}</Typography.Text>
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={`Показания за ${period(data.readings.period)}`} value={coverage} suffix="%" />
            <Progress percent={coverage} showInfo={false} size="small" />
            <Typography.Text type="secondary">
              {data.readings.meters_with_readings} из {data.readings.active_meters} счётчиков
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Link to="/passes?status=pending">
              <Statistic title="Пропуска на согласовании" value={data.passes.pending} />
            </Link>
            <Typography.Text type="secondary">действуют сейчас: {data.passes.active_now}</Typography.Text>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            title="Начислено и оплачено"
            extra={
              <Flex gap={12}>
                <Tag color="#1677ff">начислено</Tag>
                <Tag color="#52c41a">оплачено</Tag>
              </Flex>
            }
          >
            <BillingChart history={data.billing.history} />
            <Table
              size="small"
              pagination={false}
              rowKey="period"
              dataSource={[...data.billing.history].reverse().slice(0, 3)}
              columns={[
                { title: 'Период', dataIndex: 'period', render: period },
                { title: 'Начислено', dataIndex: 'charged', align: 'right', render: money },
                { title: 'Оплачено', dataIndex: 'paid', align: 'right', render: money },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Открытые заявки по категориям" style={{ height: '100%' }}>
            {categories.length === 0 ? (
              <Empty description="Открытых заявок нет" />
            ) : (
              <Flex vertical gap={12}>
                {categories.map(([category, count]) => (
                  <div key={category}>
                    <Flex justify="space-between">
                      <span>{ticketCategoryLabels[category as keyof typeof ticketCategoryLabels]}</span>
                      <strong>{count}</strong>
                    </Flex>
                    <Progress percent={(count / data.tickets.open) * 100} showInfo={false} size="small" />
                  </div>
                ))}
              </Flex>
            )}
            {data.readings.verification_due_30d > 0 && (
              <Link to="/meters">
                <Tag color="orange" style={{ marginTop: 16 }}>
                  Поверка в ближайшие 30 дней: {data.readings.verification_due_30d} счётчиков
                </Tag>
              </Link>
            )}
          </Card>
        </Col>
      </Row>
    </>
  )
}

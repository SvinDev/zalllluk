import { CalculatorOutlined, SendOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, DatePicker, Descriptions, Flex, Popconfirm, Steps, Table, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'
import { Link } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { components } from '@/api/schema'
import type { InvoiceRead } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { BuildingSelect } from '@/components/selects'
import { money, period as formatPeriod, periodParam } from '@/lib/format'

type Report = components['schemas']['BillingRunReport']

export default function BillingPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<Dayjs>(dayjs().subtract(1, 'month'))
  const [buildingId, setBuildingId] = useState<number>()
  const [report, setReport] = useState<Report | null>(null)

  const run = api.useMutation('post', '/api/v1/billing/run')
  const issue = api.useMutation('post', '/api/v1/billing/issue')
  const drafts = api.useQuery('get', '/api/v1/invoices', {
    params: { query: { period: periodParam(period), status: 'draft', building_id: buildingId, limit: 500 } },
  })

  const body = { period: periodParam(period), building_id: buildingId }
  const draftTotal = (drafts.data?.items ?? []).reduce((sum, i) => sum + Number(i.amount), 0)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/invoices'] })

  return (
    <>
      <PageHeader title="Начисления" subtitle="Расчёт квитанций за месяц по тарифам и показаниям счётчиков" />
      <Card style={{ marginBottom: 16 }}>
        <Flex gap={12} wrap align="center">
          <DatePicker
            picker="month"
            value={period}
            onChange={(v) => { if (v) { setPeriod(v); setReport(null) } }}
            format="MMMM YYYY"
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs(), 'month')}
          />
          <BuildingSelect placeholder="Все дома" style={{ width: 280 }} value={buildingId} onChange={setBuildingId} />
        </Flex>
        <Steps
          style={{ marginTop: 24 }}
          direction="vertical"
          size="small"
          items={[
            {
              title: 'Сформировать черновики',
              status: 'process',
              description: (
                <Flex vertical gap={8} style={{ paddingBottom: 16 }}>
                  <Typography.Text type="secondary">
                    Можно запускать повторно: черновики пересчитаются (например, после поздних показаний), выставленные квитанции не изменятся.
                  </Typography.Text>
                  <div>
                    <Button
                      icon={<CalculatorOutlined />}
                      loading={run.isPending}
                      onClick={async () => {
                        try {
                          setReport(await run.mutateAsync({ body }))
                          await refresh()
                        } catch (e) {
                          message.error(errorMessage(e))
                        }
                      }}
                    >
                      Рассчитать за {formatPeriod(period.format('YYYY-MM-01'))}
                    </Button>
                  </div>
                  {report && (
                    <Descriptions size="small" bordered column={{ xs: 1, md: 3 }}>
                      <Descriptions.Item label="Создано">{report.created}</Descriptions.Item>
                      <Descriptions.Item label="Пересчитано">{report.regenerated}</Descriptions.Item>
                      <Descriptions.Item label="Уже выставлены">{report.skipped_posted}</Descriptions.Item>
                      <Descriptions.Item label="Без начислений">{report.without_charges}</Descriptions.Item>
                      <Descriptions.Item label="Сумма" span={2}>{money(report.total_amount)}</Descriptions.Item>
                    </Descriptions>
                  )}
                </Flex>
              ),
            },
            {
              title: 'Проверить и выставить',
              status: drafts.data?.total ? 'process' : 'wait',
              description: (
                <Flex vertical gap={8}>
                  {drafts.data?.total ? (
                    <>
                      <Alert
                        type="info"
                        showIcon
                        message={`Черновиков: ${drafts.data.total} на сумму ${money(draftTotal)}`}
                        description="После выставления квитанции увидят жители, а в QR-коде будет сумма к оплате с учётом долга."
                      />
                      <div>
                        <Popconfirm
                          title="Выставить все черновики жителям?"
                          onConfirm={async () => {
                            try {
                              const result = await issue.mutateAsync({ body })
                              message.success(`Выставлено квитанций: ${result.issued}`)
                              await refresh()
                            } catch (e) {
                              message.error(errorMessage(e))
                            }
                          }}
                        >
                          <Button type="primary" icon={<SendOutlined />} loading={issue.isPending}>
                            Выставить все
                          </Button>
                        </Popconfirm>
                      </div>
                    </>
                  ) : (
                    <Typography.Text type="secondary">Черновиков за период нет</Typography.Text>
                  )}
                </Flex>
              ),
            },
          ]}
        />
      </Card>
      {!!drafts.data?.total && (
        <Card title="Черновики">
          <Table<InvoiceRead>
            rowKey="id"
            size="small"
            dataSource={drafts.data.items}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 600 }}
            columns={[
              { title: 'Квитанция', dataIndex: 'number', render: (n, i) => <Link to={`/invoices/${i.id}`}>{n}</Link> },
              { title: 'Адрес', render: (_, i) => `${i.apartment.building.address}, кв. ${i.apartment.number}` },
              { title: 'Начислено', dataIndex: 'amount', align: 'right', render: money },
            ]}
          />
        </Card>
      )}
    </>
  )
}

import { App, DatePicker, Form, InputNumber, Modal, Typography } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { MeterRead } from '@/api/types'
import { dateTime, quantity } from '@/lib/format'
import { meterKindLabels } from '@/lib/labels'

type Values = { value: number; taken_at?: Dayjs }

export function SubmitReadingModal({
  meter,
  allowBackdate,
  onClose,
}: {
  meter: MeterRead | null
  allowBackdate?: boolean
  onClose: () => void
}) {
  const [form] = Form.useForm<Values>()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const submit = api.useMutation('post', '/api/v1/meters/{meter_id}/readings')

  const onOk = async () => {
    if (!meter) return
    const values = await form.validateFields()
    try {
      await submit.mutateAsync({
        params: { path: { meter_id: meter.id } },
        body: { value: values.value, taken_at: values.taken_at?.toISOString() },
      })
      message.success('Показания приняты')
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/meters'] })
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/meters/{meter_id}/readings'] })
      form.resetFields()
      onClose()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const last = meter?.last_reading
  return (
    <Modal
      open={!!meter}
      title={meter ? `${meterKindLabels[meter.kind]} · № ${meter.serial_number}` : ''}
      okText="Передать"
      onOk={onOk}
      confirmLoading={submit.isPending}
      onCancel={() => {
        form.resetFields()
        onClose()
      }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {last
          ? `Предыдущее показание: ${quantity(last.value, meter?.unit)} от ${dateTime(last.taken_at)}`
          : `Начальное показание: ${quantity(meter?.initial_value, meter?.unit)}`}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="value"
          label={`Текущее показание, ${meter?.unit ?? ''}`}
          rules={[{ required: true, message: 'Введите показание' }]}
        >
          <InputNumber
            min={0}
            step={0.001}
            precision={3}
            decimalSeparator=","
            style={{ width: '100%' }}
            size="large"
            autoFocus
          />
        </Form.Item>
        {allowBackdate && (
          <Form.Item name="taken_at" label="Дата снятия (если не сегодня)">
            <DatePicker
              showTime
              format="DD.MM.YYYY HH:mm"
              style={{ width: '100%' }}
              disabledDate={(d) => d.isAfter(dayjs())}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

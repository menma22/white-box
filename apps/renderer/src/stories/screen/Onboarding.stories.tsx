import type { Meta, StoryObj } from '@storybook/react-vite'
import { DoneStep, NameStep, ShortcutsStep, WelcomeStep } from '@/features/onboarding/OnboardingSteps'

const noop = () => {}

// 既定の padded だと本物の窓より内側が狭くなり、ありもしない折り返しが出る
const meta: Meta = {
  title: 'screen/Onboarding',
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj

export const Welcome: Story = {
  render: () => <WelcomeStep onNext={noop} />,
}

export const Name: Story = {
  render: () => <NameStep value="" onChange={noop} onBack={noop} onNext={noop} />,
}

export const NameFilled: Story = {
  render: () => <NameStep value="まひろ" onChange={noop} onBack={noop} onNext={noop} />,
}

export const Shortcuts: Story = {
  render: () => (
    <ShortcutsStep
      value={{ startPause: '', currentWork: '', dashboard: '' }}
      onChange={noop}
      onSkip={noop}
      onBack={noop}
      onNext={noop}
    />
  ),
}

export const ShortcutsAssigned: Story = {
  render: () => (
    <ShortcutsStep
      value={{ startPause: 'Control+Alt+S', currentWork: 'Control+Alt+W', dashboard: 'Control+Alt+D' }}
      onChange={noop}
      onSkip={noop}
      onBack={noop}
      onNext={noop}
    />
  ),
}

export const ShortcutsDuplicated: Story = {
  render: () => (
    <ShortcutsStep
      value={{ startPause: 'Control+Alt+S', currentWork: 'Control+Alt+S', dashboard: '' }}
      onChange={noop}
      onSkip={noop}
      onBack={noop}
      onNext={noop}
    />
  ),
}

export const Done: Story = {
  render: () => (
    <DoneStep
      name="まひろ"
      shortcuts={{ startPause: 'Control+Alt+S', currentWork: 'Control+Alt+W', dashboard: 'Control+Alt+D' }}
      onFinish={noop}
    />
  ),
}

export const DoneSkipped: Story = {
  render: () => <DoneStep name="" shortcuts={{ startPause: '', currentWork: '', dashboard: '' }} onFinish={noop} />,
}

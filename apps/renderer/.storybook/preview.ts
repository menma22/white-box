import '../src/styles/base.css'
import '../src/styles/components.css'
import '../src/styles/app.css'
import '../src/styles/notion.css'
import type { Preview } from '@storybook/react-vite'

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'canvas',
      values: [{ name: 'canvas', value: '#f5f2ec' }],
    },
  },
}

export default preview

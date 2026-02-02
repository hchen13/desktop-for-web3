/**
 * 入口文件
 */

import { render } from 'solid-js/web';
import { App } from './App';
import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';

const root = document.getElementById('app');

if (root) {
  render(() => <App />, root);
}

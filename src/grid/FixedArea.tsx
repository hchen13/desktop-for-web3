/**
 * 固定元素区域组件 - 搜索框和时间
 */

import { SearchBar } from '../components/SearchBar/SearchBar';
import { TimeDisplay } from '../components/TimeDisplay/TimeDisplay';
import './grid.css';

export const FixedArea = () => {
  return (
    <div class="grid-fixed-area">
      <div style="display: flex; flex-direction: column; align-items: center; gap: 24px;">
        <SearchBar />
        <TimeDisplay />
      </div>
    </div>
  );
};

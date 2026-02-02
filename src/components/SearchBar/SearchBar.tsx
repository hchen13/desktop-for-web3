/**
 * 搜索栏组件
 */

import { createSignal } from 'solid-js';
import { getSearchUrl, getSuggestionLabel } from './searchUtils';

export const SearchBar = () => {
  const [query, setQuery] = createSignal('');
  let inputRef: HTMLInputElement;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const q = query().trim();
    if (!q) return;

    const url = getSearchUrl(q);
    window.location.href = url;
  };

  const suggestionLabel = () => getSuggestionLabel(query());

  return (
    <div class="search-bar-container">
      <form class="search-bar" onSubmit={handleSubmit}>
        <svg
          class="search-bar__icon"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <input
          ref={inputRef!}
          id="search-input"
          name="search"
          type="text"
          class="search-bar__input"
          placeholder="Search web3"
          spellcheck={false}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        {suggestionLabel() && (
          <div class="search-bar__suggestion">{suggestionLabel()}</div>
        )}
      </form>
    </div>
  );
};

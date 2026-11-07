import Icon from "./Icon";

interface Props {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}

export default function Pager({ page, limit, total, onPage }: Props) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="pager">
      <span>
        {from}–{to} of {total}
      </span>
      <span className="spacer" />
      <button className="icon-only" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="chevronLeft" />
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button className="icon-only" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

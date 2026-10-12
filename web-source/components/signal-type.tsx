import React from 'react';

/** A missing stylesheet must leave one readable copy. The theme opts into cut print. */
export default function SignalType({children}: {children: string}) {
  return <span className="nc-signal-type"><span className="nc-type-source">{children}</span><span className="nc-type-fragment" hidden aria-hidden="true">{children}</span></span>;
}

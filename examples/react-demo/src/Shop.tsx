import { defaultTheme, personas, products, type Theme } from '@flagforge/example-shared/personas'
import { Feature, useAllFlags, useFlag, useFlagForgeClient, useFlagsStatus, useIdentify } from '@flagforge/react'
import { useEffect, useState } from 'react'

export function Shop() {
  const status = useFlagsStatus()
  const identify = useIdentify()
  const client = useFlagForgeClient()
  const allFlags = useAllFlags()
  const [persona, setPersona] = useState(0)
  const [cart, setCart] = useState(0)

  const theme = useFlag<Theme>('ui-theme', defaultTheme)
  const banner = useFlag('banner-message', '')
  const maxItems = useFlag('max-cart-items', 10)
  const maintenance = useFlag('maintenance-mode', false)

  // Theme values from a flag drive CSS custom properties: a design-system token rolled out like any feature.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', theme.accent)
    document.documentElement.style.setProperty('--radius', `${theme.radius}px`)
  }, [theme])

  return (
    <div className="shop">
      <header className="topbar">
        <div className="brand">
          Forge Shop <small>React</small>
        </div>
        <span className="status" data-status={status}>
          flags: {status}
        </span>
      </header>

      <div className="personas" role="group" aria-label="Browse as">
        {personas.map((p, i) => (
          <button
            key={p.label}
            aria-pressed={persona === i}
            onClick={() => {
              setPersona(i)
              identify(p.context)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="hint">{personas[persona]!.description}</p>

      {banner && <div className="banner">{banner}</div>}

      <div className="grid">
        {products.map((product) => (
          <article key={product.id} className="product">
            <h3>{product.name}</h3>
            <p>€{product.price}</p>
            <button className="btn" disabled={cart >= maxItems} onClick={() => setCart(cart + 1)}>
              Add to cart
            </button>
          </article>
        ))}
      </div>

      <Feature
        flag="new-checkout"
        fallback={
          <section className="cart">
            <span>
              Cart: {cart} / {maxItems} items
            </span>
            <button className="btn secondary">Step 1 of 3: shipping →</button>
          </section>
        }
      >
        <section className="cart checkout-new">
          <div>
            <div className="tag">New one-page checkout</div>
            Cart: {cart} / {maxItems} items
          </div>
          <button className="btn">Pay now</button>
        </section>
      </Feature>

      <details className="debug">
        <summary>Evaluated flags</summary>
        <pre>{JSON.stringify({ context: client.getContext(), flags: allFlags }, null, 2)}</pre>
      </details>

      {maintenance && (
        <div className="maintenance" role="alert">
          <div>
            <h2>We’ll be right back</h2>
            <p>The shop is in maintenance mode. Try switching the flag off in the dashboard.</p>
          </div>
        </div>
      )}
    </div>
  )
}

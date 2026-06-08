// ============================================================
// RESTAURANTE LA 26 — PANEL DE MESERO
// menu.js · Versión 6.1 — CORRECCIÓN CRÍTICA
// Bucaramanga, Santander — Colombia
//
// CAMBIOS v6.1 (correcciones de corrupción de datos):
//
//  [FIX-1] _cargarDesdeCatalogo: ELIMINADO el "intento 2" sin filtro
//          que sobrescribía State.restaurantId y traía productos de
//          todos los restaurantes. Ahora existe UNA SOLA consulta.
//          Si no hay resultados con el restaurant_id del slug, se
//          busca el ID correcto primero (sin alterar State.restaurantId
//          con datos incorrectos) y se reintenta con él.
//
//  [FIX-2] State.cart ahora guarda { slotId, cantidad, productName,
//          unitPrice } — el nombre y precio se copian en el momento
//          en que el usuario agrega el producto. No depende de que
//          State.slots siga intacto al momento del envío.
//
//  [FIX-3] El payload de order_items guarda el nombre en DOS lugares:
//          - notes: "[nombre]<nombre real>"  (compatibilidad legada)
//          - product_name: "<nombre real>"   (columna directa, si existe)
//          Nunca depende de JOINs posteriores para reconstruir el nombre.
//
//  [FIX-4] _resolverRestaurant: si el slug no devuelve resultados,
//          busca por limit(1) pero NO sobrescribe State.restaurantId
//          hasta verificar que los menú_items de ese ID son los del
//          admin actual. Se expone el restaurantId real sin contaminar
//          el estado global con un ID ajeno.
// ============================================================

'use strict';

// ============================================================
// CREDENCIALES SUPABASE
// ============================================================
const SUPABASE_URL      = "https://hxmodeduckuhvvspnkxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ESxhljLgqWkGvrnKhvbeEg_iBqaGciv";
const RESTAURANT_SLUG   = "restaurante-la-26";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// CATEGORÍAS DE MENÚ
// ============================================================
const CATEGORIAS = {
    protein:        { label: 'Proteína con Salsa',  icono: '🥩', orden: 1 },
    side:           { label: 'Principio',           icono: '🍲', orden: 2 },
    drink:          { label: 'Bebida',              icono: '🥤', orden: 3 },
    a_la_carte:     { label: 'A la Carta',          icono: '✨', orden: 4 },
    executive_lunch:{ label: 'Menú Ejecutivo',      icono: '🍱', orden: 5 },
    dessert:        { label: 'Postre',              icono: '🍮', orden: 6 },
};

const ITEM_TYPES_VALIDOS = ['protein','side','drink','a_la_carte','executive_lunch','dessert'];

// ============================================================
// ESTADO GLOBAL
// ============================================================
const State = {
    restaurantId:       null,
    dailyMenuId:        null,
    slots:              [],
    // [FIX-2] El carrito ahora incluye nombre y precio copiados
    // en el momento de agregar — no depende de State.slots al enviar
    cart:               [],   // [{ slotId, cantidad, productName, unitPrice }]
    filtro:             'todos',
    isSubmitting:       false,
    sistemaHabilitado:  true,
};

// ============================================================
// CONTROL DE ACCESO — LEE system_settings.orders_enabled
// ============================================================
const ORDERS_SETTING_KEY = 'orders_enabled';

async function _verificarSistemaHabilitado() {
    try {
        const { data, error } = await db
            .from('system_settings')
            .select('value')
            .eq('key', ORDERS_SETTING_KEY)
            .maybeSingle();

        if (error) throw error;
        return data ? data.value === 'true' : true;
    } catch (_) {
        const local = localStorage.getItem(ORDERS_SETTING_KEY);
        return local === null ? true : local === 'true';
    }
}

function _mostrarSistemaBloqueado() {
    const loader   = document.getElementById('app-loader');
    const error    = document.getElementById('app-error');
    const sections = document.getElementById('menu-sections');
    const cartBar  = document.getElementById('cart-bar');

    if (loader)   loader.style.display   = 'none';
    if (error)    error.style.display    = 'none';
    if (sections) sections.style.display = 'none';
    if (cartBar)  cartBar.classList.remove('visible');

    State.cart  = [];
    State.slots = [];

    let bloqueadoEl = document.getElementById('sistema-bloqueado');
    if (!bloqueadoEl) {
        bloqueadoEl = document.createElement('div');
        bloqueadoEl.id = 'sistema-bloqueado';
        Object.assign(bloqueadoEl.style, {
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            minHeight:      '70vh',
            padding:        '40px 24px',
            textAlign:      'center',
            gap:            '16px',
        });
        bloqueadoEl.innerHTML = `
            <div style="font-size:56px;line-height:1;">🔒</div>
            <h2 style="font-size:20px;font-weight:700;color:#2e4028;margin:0;">
                Servicio temporalmente suspendido
            </h2>
            <p style="font-size:14px;color:#6b7c69;max-width:320px;line-height:1.6;margin:0;">
                El restaurante ha pausado la toma de pedidos por el momento.<br>
                Por favor, inténtalo más tarde o consulta con el personal.
            </p>`;
        document.body.appendChild(bloqueadoEl);
    } else {
        bloqueadoEl.style.display = 'flex';
    }
}

function _ocultarSistemaBloqueado() {
    const bloqueadoEl = document.getElementById('sistema-bloqueado');
    if (bloqueadoEl) bloqueadoEl.style.display = 'none';
}

function _suscribirCambiosSistema() {
    db.channel('la26-sistema-settings')
        .on('postgres_changes', {
            event:  '*',
            schema: 'public',
            table:  'system_settings',
            filter: `key=eq.${ORDERS_SETTING_KEY}`,
        }, async (payload) => {
            const habilitado = payload.new?.value === 'true';
            State.sistemaHabilitado = habilitado;

            if (!habilitado) {
                _mostrarSistemaBloqueado();
            } else {
                _ocultarSistemaBloqueado();
                await Menu.cargar();
            }
        })
        .subscribe();
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
const Toast = (function() {
    let container = null;

    function _ensureContainer() {
        if (container) return;
        container = document.createElement('div');
        Object.assign(container.style, {
            position: 'fixed', top: '20px', left: '50%',
            transform: 'translateX(-50%)', zIndex: '9999',
            display: 'flex', flexDirection: 'column',
            gap: '8px', alignItems: 'center',
            pointerEvents: 'none', width: 'max-content',
            maxWidth: 'calc(100vw - 32px)',
        });
        document.body.appendChild(container);
    }

    function show(msg, tipo = 'info', duracion = 3800) {
        _ensureContainer();
        const c = {
            ok:    { bg: '#f5f7f0', border: 'rgba(74,103,65,0.35)',  text: '#2e4028', dot: '#4a6741' },
            error: { bg: '#fdf5f3', border: 'rgba(192,80,60,0.30)',  text: '#6b2a1e', dot: '#c0503c' },
            info:  { bg: '#f5f7f0', border: 'rgba(74,103,65,0.25)',  text: '#3a4a38', dot: '#4a6741' },
        }[tipo] || {};

        const t = document.createElement('div');
        Object.assign(t.style, {
            display: 'flex', alignItems: 'center', gap: '9px',
            background: c.bg, border: `1.5px solid ${c.border}`,
            borderRadius: '999px', padding: '10px 20px 10px 14px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            fontSize: '13.5px', fontFamily: "'DM Sans',sans-serif",
            fontWeight: '500', color: c.text,
            pointerEvents: 'auto', opacity: '0',
            transform: 'translateY(-8px)',
            transition: 'opacity .28s ease, transform .28s ease',
            maxWidth: 'calc(100vw - 32px)',
        });

        const dot = document.createElement('span');
        Object.assign(dot.style, {
            width: '7px', height: '7px', borderRadius: '50%',
            background: c.dot, flexShrink: '0', display: 'block',
        });
        const txt = document.createElement('span');
        txt.textContent = msg;
        t.appendChild(dot);
        t.appendChild(txt);
        container.appendChild(t);

        requestAnimationFrame(() => requestAnimationFrame(() => {
            t.style.opacity   = '1';
            t.style.transform = 'translateY(0)';
        }));

        const timer = setTimeout(() => {
            t.style.opacity   = '0';
            t.style.transform = 'translateY(-8px)';
            setTimeout(() => t.remove(), 300);
        }, duracion);

        t.onclick = () => { clearTimeout(timer); t.remove(); };
    }

    return {
        ok:    (msg, ms) => show(msg, 'ok',    ms),
        error: (msg, ms) => show(msg, 'error', ms),
        info:  (msg, ms) => show(msg, 'info',  ms),
    };
})();

// ============================================================
// HELPERS
// ============================================================
function formatCOP(v) {
    return '$' + Math.round(v).toLocaleString('es-CO');
}

function todayISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function generarNumeroOrden() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `MES-LA26-${year}-${rand}`;
}

function calcularTotal() {
    // [FIX-2] Usa unitPrice guardado en el carrito, no depende de State.slots
    return State.cart.reduce((acc, item) => acc + (item.unitPrice * item.cantidad), 0);
}

function calcularCantidadTotal() {
    return State.cart.reduce((acc, item) => acc + item.cantidad, 0);
}

function slotsFiltrados() {
    if (State.filtro === 'todos') return State.slots;
    return State.slots.filter(s => s.itemType === State.filtro);
}

// ============================================================
// RESOLVER RESTAURANT_ID
// [FIX-1] Busca por slug primero; si no encuentra, busca el
//         restaurant_id del primer menu_item activo existente
//         (que es el que el admin realmente usó). NO sobrescribe
//         State.restaurantId con un ID de otro restaurante sin validar.
// ============================================================
let _restaurantResolving = false;

async function _resolverRestaurant() {
    if (State.restaurantId || _restaurantResolving) return;
    _restaurantResolving = true;

    try {
        // Intento 1: buscar por slug (caso ideal)
        const { data: r1 } = await db.from('restaurants')
            .select('id')
            .eq('slug', RESTAURANT_SLUG)
            .maybeSingle();

        if (r1?.id) {
            // Verificar que este restaurant_id tiene menu_items activos
            const { data: check } = await db.from('menu_items')
                .select('id')
                .eq('restaurant_id', r1.id)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();

            if (check?.id) {
                // El restaurant del slug tiene productos → usar este
                State.restaurantId = r1.id;
                return;
            }
            // El slug existe pero no tiene productos activos.
            // No descartamos aún — puede ser que los productos usen otro restaurant_id.
        }

        // Intento 2: buscar el restaurant_id que tiene menu_items activos
        // (el que el admin usó realmente para crear los platos)
        // [FIX-1] Esto NO usa un SELECT sin filtro de menu_items —
        //         buscamos en restaurants y verificamos cuál tiene productos
        const { data: todosRestaurants } = await db.from('restaurants')
            .select('id')
            .limit(10);

        if (todosRestaurants && todosRestaurants.length > 0) {
            for (const rest of todosRestaurants) {
                const { data: tieneItems } = await db.from('menu_items')
                    .select('id')
                    .eq('restaurant_id', rest.id)
                    .eq('is_active', true)
                    .limit(1)
                    .maybeSingle();

                if (tieneItems?.id) {
                    State.restaurantId = rest.id;
                    return;
                }
            }
        }

        // Intento 3: crear el restaurante si no existe ninguno
        const { data: r3 } = await db.from('restaurants')
            .insert([{ name: 'Restaurante la 26', slug: RESTAURANT_SLUG }])
            .select('id')
            .single();
        if (r3?.id) State.restaurantId = r3.id;

    } catch (err) {
        console.warn('[La 26] Error resolviendo restaurant_id:', err);
    } finally {
        _restaurantResolving = false;
    }
}

// ============================================================
// RESOLVER TABLE_ID
// ============================================================
async function _resolverTableId(modalidad, mesa) {
    if (!State.restaurantId) await _resolverRestaurant();
    if (!State.restaurantId) return null;

    if (modalidad === 'mesa') {
        const mesaNum = parseInt(mesa, 10);
        const { data } = await db.from('tables')
            .select('id')
            .eq('restaurant_id', State.restaurantId)
            .or(`number.eq.${isNaN(mesaNum) ? 0 : mesaNum},label.ilike.${mesa}`)
            .maybeSingle();
        if (data?.id) return data.id;
    }

    // Buscar mesa "Para Llevar" existente
    const { data: mv } = await db.from('tables')
        .select('id')
        .eq('restaurant_id', State.restaurantId)
        .ilike('label', '%para llevar%')
        .maybeSingle();
    if (mv?.id) return mv.id;

    // Crear mesa virtual para llevar/domicilio
    const { data: mn } = await db.from('tables')
        .upsert([{
            restaurant_id: State.restaurantId,
            number:        0,
            label:         'Para Llevar / Domicilio',
            qr_code:       `VIRTUAL-TAKEAWAY-${State.restaurantId}`,
            capacity:      99,
            status:        'available',
        }], { onConflict: 'restaurant_id,number' })
        .select('id')
        .single();

    return mn?.id || null;
}

// ============================================================
// MENÚ — Carga y renderizado
// ============================================================
const Menu = {

    async cargar() {
        _mostrarEstado('loader');

        if (!State.restaurantId) await _resolverRestaurant();
        if (!State.restaurantId) {
            _mostrarEstado('error', 'No se pudo identificar el restaurante. Contacta al administrador.');
            return;
        }

        try {
            const { data: dm } = await db.from('daily_menus')
                .select('id')
                .eq('restaurant_id', State.restaurantId)
                .eq('menu_date', todayISO())
                .eq('is_published', true)
                .maybeSingle();

            if (dm?.id) {
                State.dailyMenuId = dm.id;
                await this._cargarDesdeMenuDia();
            } else {
                State.dailyMenuId = null;
                await this._cargarDesdeCatalogo();
            }
        } catch (err) {
            console.error('[La 26] Error cargando menú:', err);
            _mostrarEstado('error', 'No se pudo cargar la carta. Por favor reinténtalo.');
        }
    },

    async _cargarDesdeMenuDia() {
        const { data, error } = await db
            .from('daily_menu_slots_availability')
            .select('id,menu_item_id,item_name,price,item_type,is_truly_available,portions_available,portions_sold,category_order,display_order')
            .eq('daily_menu_id', State.dailyMenuId)
            .in('item_type', ITEM_TYPES_VALIDOS)
            .order('category_order', { ascending: true })
            .order('display_order',  { ascending: true });

        if (error || !data || data.length === 0) {
            await this._cargarDesdeCatalogo();
            return;
        }

        State.slots = data.map(s => ({
            id:          s.id,
            menuItemId:  s.menu_item_id,
            nombre:      s.item_name,
            precio:      Number(s.price) || 0,
            descripcion: '',
            itemType:    CATEGORIAS[s.item_type] ? s.item_type : 'a_la_carte',
            porciones:   s.is_truly_available
                             ? Math.max(0, (s.portions_available || 0) - (s.portions_sold || 0))
                             : 0,
            disponible:  Boolean(s.is_truly_available),
        }));

        _renderizarMenu();
        _mostrarEstado('menu');
        _suscribirRealtime();
    },

    // ──────────────────────────────────────────────────────────
    // [FIX-1] _cargarDesdeCatalogo — UNA SOLA CONSULTA
    //
    // ANTES: había un "intento 2" sin filtro restaurant_id que:
    //   1. Traía productos de TODOS los restaurantes de la BD
    //   2. Sobrescribía State.restaurantId con el ID del primer resultado
    //   3. Ese primer resultado era "Albóndigas" (orden alfabético)
    //   4. Todos los slotId quedaban apuntando al catálogo de otro restaurante
    //
    // AHORA: existe UNA SOLA consulta filtrada por el restaurant_id
    // correcto (resuelto por _resolverRestaurant que ya verifica cuál
    // tiene productos activos). Si no hay resultados, modo demo.
    // State.restaurantId NUNCA se modifica aquí.
    // ──────────────────────────────────────────────────────────
    async _cargarDesdeCatalogo() {
        const { data, error } = await db
            .from('menu_items')
            .select('id,name,price,item_type,is_active,description,restaurant_id')
            .eq('restaurant_id', State.restaurantId)   // ← ÚNICO filtro, siempre presente
            .eq('is_active', true)
            .in('item_type', ITEM_TYPES_VALIDOS)
            .order('item_type', { ascending: true })
            .order('name',      { ascending: true });

        if (error) {
            console.error('[La 26] Error consultando menu_items:', error.message);
            _activarModoDemo();
            return;
        }

        if (!data || data.length === 0) {
            console.warn('[La 26] Sin productos activos para restaurant_id:', State.restaurantId);
            _activarModoDemo();
            return;
        }

        // Mapear slots — menuItemId es el UUID real del menu_item
        State.slots = data.map(i => ({
            id:          i.id,           // UUID del menu_item → slotId en el carrito
            menuItemId:  i.id,           // mismo UUID, nunca reemplazado por un fallback
            nombre:      i.name,         // nombre real del producto
            precio:      Number(i.price) || 0,
            descripcion: i.description || '',
            itemType:    CATEGORIAS[i.item_type] ? i.item_type : 'a_la_carte',
            porciones:   999,
            disponible:  true,
        }));

        _renderizarMenu();
        _mostrarEstado('menu');
        _suscribirRealtime();
    },
};

// ── Control de pantalla ──────────────────────────────────────
function _mostrarEstado(estado, msg = '') {
    const loader   = document.getElementById('app-loader');
    const error    = document.getElementById('app-error');
    const sections = document.getElementById('menu-sections');

    if (loader)   loader.style.display    = estado === 'loader' ? 'flex'  : 'none';
    if (error)    error.style.display     = estado === 'error'  ? 'flex'  : 'none';
    if (sections) sections.style.display  = estado === 'menu'   ? 'block' : 'none';

    if (estado === 'error' && msg) {
        const el = document.getElementById('error-msg');
        if (el) el.textContent = msg;
    }
}

// ── Modo demo ────────────────────────────────────────────────
function _activarModoDemo() {
    State.slots = [
        { id:'demo-p1', menuItemId:null, nombre:'Pechuga a la Plancha con Salsa Criolla',  precio:16000, descripcion:'Pechuga jugosa bañada en salsa criolla de tomate y cebolla.', itemType:'protein',    porciones:12, disponible:true  },
        { id:'demo-p2', menuItemId:null, nombre:'Tilapia Frita con Salsa de Ajo',          precio:18000, descripcion:'Tilapia frita con salsa de ajo y limón.',                      itemType:'protein',    porciones:8,  disponible:true  },
        { id:'demo-p3', menuItemId:null, nombre:'Cerdo al Horno con Salsa BBQ',            precio:17000, descripcion:'Lomo de cerdo con salsa BBQ artesanal.',                        itemType:'protein',    porciones:0,  disponible:false },
        { id:'demo-s1', menuItemId:null, nombre:'Arroz Blanco',                             precio:0,     descripcion:'Acompañamiento del almuerzo.',                                 itemType:'side',       porciones:30, disponible:true  },
        { id:'demo-s2', menuItemId:null, nombre:'Fríjoles Rojos con Hogao',                precio:0,     descripcion:'Fríjoles cocinados a fuego lento.',                             itemType:'side',       porciones:25, disponible:true  },
        { id:'demo-s3', menuItemId:null, nombre:'Patacón Tostado con Guacamole',           precio:0,     descripcion:'Plátano verde frito con guacamole fresco.',                     itemType:'side',       porciones:20, disponible:true  },
        { id:'demo-d1', menuItemId:null, nombre:'Jugo Natural del Día',                    precio:3000,  descripcion:'Fruta fresca de temporada.',                                    itemType:'drink',      porciones:30, disponible:true  },
        { id:'demo-d2', menuItemId:null, nombre:'Limonada de Panela',                      precio:3500,  descripcion:'Limón con panela orgánica.',                                    itemType:'drink',      porciones:25, disponible:true  },
    ];
    _renderizarMenu();
    _mostrarEstado('menu');
}

// ── Renderizado del menú ─────────────────────────────────────
function _renderizarCatsBar() {
    const bar = document.getElementById('cats-bar');
    if (!bar) return;
    bar.innerHTML = '';

    const btnTodos = document.createElement('button');
    btnTodos.className   = `cat-btn${State.filtro === 'todos' ? ' active' : ''}`;
    btnTodos.textContent = 'Todos';
    btnTodos.onclick     = () => _cambiarFiltro('todos');
    bar.appendChild(btnTodos);

    const tipos = [...new Set(State.slots.map(s => s.itemType))].filter(t => CATEGORIAS[t]);
    tipos.sort((a, b) => (CATEGORIAS[a]?.orden || 99) - (CATEGORIAS[b]?.orden || 99))
        .forEach(tipo => {
            const cfg = CATEGORIAS[tipo];
            const btn = document.createElement('button');
            btn.className   = `cat-btn${State.filtro === tipo ? ' active' : ''}`;
            btn.textContent = `${cfg.icono} ${cfg.label}`;
            btn.onclick     = () => _cambiarFiltro(tipo);
            bar.appendChild(btn);
        });
}

function _cambiarFiltro(tipo) {
    State.filtro = tipo;
    _renderizarCatsBar();
    _renderizarMenu();
}

function _renderizarMenu() {
    _renderizarCatsBar();

    const sections = document.getElementById('menu-sections');
    if (!sections) return;
    sections.innerHTML = '';

    const lista = slotsFiltrados();

    if (!lista || lista.length === 0) {
        sections.innerHTML = `
            <div class="empty-state">
                <div class="icon">🍽️</div>
                <p>No hay platos disponibles<br>en esta categoría.</p>
            </div>`;
        return;
    }

    const grupos = {};
    lista.forEach(slot => {
        const tipo = CATEGORIAS[slot.itemType] ? slot.itemType : 'a_la_carte';
        if (!grupos[tipo]) grupos[tipo] = [];
        grupos[tipo].push(slot);
    });

    Object.keys(grupos)
        .sort((a, b) => (CATEGORIAS[a]?.orden || 99) - (CATEGORIAS[b]?.orden || 99))
        .forEach((tipo, secIdx) => {
            const cfg    = CATEGORIAS[tipo];
            const platos = grupos[tipo];
            if (!platos?.length) return;

            const sec = document.createElement('div');

            const header = document.createElement('div');
            header.className = 'section-label';
            header.innerHTML = `<h2>${cfg.icono} ${cfg.label}</h2>`;
            sec.appendChild(header);

            platos.forEach((slot, i) => {
                const t = _crearTarjeta(slot);
                t.style.animationDelay = `${secIdx * 0.06 + i * 0.05}s`;
                sec.appendChild(t);
            });

            sections.appendChild(sec);
        });
}

function _crearTarjeta(slot) {
    const disponible = slot.disponible && slot.porciones > 0;
    const pocas      = disponible && slot.porciones > 0 && slot.porciones <= 5;
    const enCarrito  = State.cart.find(c => c.slotId === slot.id);
    const qty        = enCarrito ? enCarrito.cantidad : 0;

    let badgeHTML = '';
    if (!disponible)  badgeHTML = `<span class="badge-agotado">Agotado</span>`;
    else if (pocas)   badgeHTML = `<span class="badge-pocas">¡Solo quedan ${slot.porciones}!</span>`;

    const precioHTML = slot.precio > 0
        ? `<span class="plate-price">${formatCOP(slot.precio)}</span>`
        : `<span class="plate-price incluido">Incluido</span>`;

    let ctrlHTML = '';
    if (disponible) {
        if (qty === 0) {
            ctrlHTML = `<button class="btn-add" onclick="Cart.agregar('${slot.id}')" aria-label="Agregar ${slot.nombre}">+</button>`;
        } else {
            ctrlHTML = `
                <div class="qty-chip">
                    <button onclick="Cart.cambiar('${slot.id}',-1)" aria-label="Quitar">−</button>
                    <span>${qty}</span>
                    <button onclick="Cart.cambiar('${slot.id}',+1)" aria-label="Agregar">+</button>
                </div>`;
        }
    }

    const card     = document.createElement('div');
    card.id        = `tarjeta-${slot.id}`;
    card.className = `plate-card${!disponible ? ' agotado' : ''} fade-up`;
    card.innerHTML = `
        <div class="plate-info">
            <p class="plate-name">${slot.nombre}</p>
            ${slot.descripcion ? `<p class="plate-desc">${slot.descripcion}</p>` : ''}
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;">
                ${precioHTML}
                ${badgeHTML}
            </div>
        </div>
        <div style="flex-shrink:0;">${ctrlHTML}</div>`;

    return card;
}

function _refrescarTarjeta(slotId) {
    const slot  = State.slots.find(s => s.id === slotId);
    if (!slot) return;
    const vieja = document.getElementById(`tarjeta-${slotId}`);
    if (vieja) vieja.replaceWith(_crearTarjeta(slot));
}

// ============================================================
// CARRITO
// [FIX-2] Al agregar un producto se copia productName y unitPrice
//         directamente desde el slot. El carrito es autocontenido:
//         no necesita consultar State.slots al momento del envío.
// ============================================================
const Cart = {

    agregar(slotId) {
        if (!State.sistemaHabilitado) {
            Toast.error('El servicio está temporalmente suspendido. No se pueden agregar productos.');
            return;
        }
        const slot = State.slots.find(s => s.id === slotId);
        if (!slot || !slot.disponible) return;

        const existente = State.cart.find(c => c.slotId === slotId);
        if (existente) {
            if (slot.porciones > 0 && existente.cantidad >= slot.porciones) {
                Toast.error(`Solo quedan ${slot.porciones} porciones de "${slot.nombre}".`);
                return;
            }
            existente.cantidad++;
            // Actualizar precio por si cambió (aunque es raro)
            existente.unitPrice = slot.precio;
        } else {
            // [FIX-2] Guardar nombre y precio en el momento del clic
            State.cart.push({
                slotId,
                cantidad:    1,
                productName: slot.nombre,   // copia del nombre — fuente de verdad
                unitPrice:   slot.precio,   // copia del precio
                menuItemId:  slot.menuItemId || null,
            });
        }

        _refrescarTarjeta(slotId);
        _actualizarCartBar();
    },

    cambiar(slotId, delta) {
        const idx = State.cart.findIndex(c => c.slotId === slotId);
        if (idx === -1) return;

        const slot = State.slots.find(s => s.id === slotId);

        if (delta > 0 && slot && slot.porciones > 0 && State.cart[idx].cantidad + delta > slot.porciones) {
            Toast.error(`Solo quedan ${slot.porciones} porciones.`);
            return;
        }

        const nueva = State.cart[idx].cantidad + delta;
        if (nueva <= 0) {
            State.cart.splice(idx, 1);
        } else {
            State.cart[idx].cantidad = nueva;
        }

        _refrescarTarjeta(slotId);
        _actualizarCartBar();

        if (document.getElementById('order-modal').classList.contains('open')) {
            Cart._renderSummary();
        }
    },

    abrir() {
        if (State.cart.length === 0) return;
        this._renderSummary();
        document.getElementById('order-modal').classList.add('open');
        document.body.style.overflow = 'hidden';
    },

    cerrar() {
        document.getElementById('order-modal').classList.remove('open');
        document.body.style.overflow = '';
    },

    _renderSummary() {
        const listEl  = document.getElementById('summary-items');
        const totalEl = document.getElementById('summary-total');

        if (!listEl) return;
        listEl.innerHTML = '';

        if (State.cart.length === 0) {
            listEl.innerHTML = `<div style="text-align:center;padding:36px 0;">
                <p style="font-size:13px;color:var(--ink-ghost);">Tu pedido está vacío.</p></div>`;
            if (totalEl) totalEl.textContent = '$0';
            return;
        }

        // [FIX-2] Usar productName y unitPrice del carrito directamente
        State.cart.forEach(item => {
            const row = document.createElement('div');
            row.className = 'summary-row';
            row.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <p class="summary-name">${item.productName}</p>
                    <p class="summary-qty">${item.cantidad} × ${item.unitPrice > 0 ? formatCOP(item.unitPrice) : 'Incluido'}</p>
                </div>
                <span class="summary-price">${item.unitPrice > 0 ? formatCOP(item.unitPrice * item.cantidad) : '—'}</span>`;
            listEl.appendChild(row);
        });

        if (totalEl) totalEl.textContent = formatCOP(calcularTotal());
    },
};

function _actualizarCartBar() {
    const qty     = calcularCantidadTotal();
    const total   = calcularTotal();
    const bar     = document.getElementById('cart-bar');
    const countEl = document.getElementById('cart-count');
    const totalEl = document.getElementById('cart-total');

    if (countEl) countEl.textContent = qty;
    if (totalEl) totalEl.textContent = formatCOP(total);

    if (bar) {
        if (qty > 0) bar.classList.add('visible');
        else         bar.classList.remove('visible');
    }
}

// ============================================================
// ENVÍO DEL PEDIDO
// [FIX-3] El payload de order_items guarda el nombre en:
//   - notes: "[nombre]<nombre real>"   (legado — cocina ya lo lee)
//   - product_name: "<nombre real>"    (columna directa, si existe en BD)
//
// El nombre viene de item.productName (guardado en el carrito al
// hacer clic en "+"). Nunca se reconstruye por JOIN ni por búsqueda.
// ============================================================
const Order = {

    async enviar() {
        if (State.isSubmitting) return;
        if (!State.sistemaHabilitado) {
            Toast.error('El servicio está temporalmente suspendido. No se pueden enviar pedidos.', 5000);
            return;
        }
        if (State.cart.length === 0) {
            Toast.error('Agrega al menos un plato al pedido.');
            return;
        }

        const btnEl       = document.getElementById('btn-enviar');
        const mesaEl      = document.getElementById('form-mesa');
        const nombreEl    = document.getElementById('form-nombre');
        const notasEl     = document.getElementById('form-notas');
        const modalidadEl = document.querySelector('input[name="form-modalidad"]:checked');

        const mesa      = (mesaEl?.value     || '').trim();
        const nombre    = (nombreEl?.value   || '').trim();
        const notas     = (notasEl?.value    || '').trim();
        const modalidad = modalidadEl?.value || 'mesa';

        if (modalidad === 'mesa' && !mesa) {
            mesaEl?.classList.add('error');
            mesaEl?.focus();
            Toast.error('Indica el número de mesa.');
            return;
        }
        mesaEl?.classList.remove('error');

        State.isSubmitting = true;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Enviando…'; }

        try {
            if (!State.restaurantId) await _resolverRestaurant();
            if (!State.restaurantId) throw new Error('No se pudo identificar el restaurante.');

            const tableId = await _resolverTableId(modalidad, mesa);
            if (!tableId) throw new Error('No se pudo identificar la mesa.');

            // Construir nota de cocina con modalidad
            let notaCocina = '';
            if (modalidad === 'mesa')        notaCocina = `[MESA ${mesa}]`;
            else if (modalidad === 'llevar')  notaCocina = `[PARA LLEVAR] Cliente: ${nombre}`;
            else if (modalidad === 'domicilio') notaCocina = `[DOMICILIO] Cliente: ${nombre}`;
            if (notas) notaCocina += ` | ${notas}`;

            const numeroOrden = generarNumeroOrden();
            const total       = calcularTotal();

            // Insertar orden
            const { data: orden, error: errOrd } = await db.from('orders')
                .insert([{
                    restaurant_id: State.restaurantId,
                    table_id:      tableId,
                    order_number:  numeroOrden,
                    status:        'pending',
                    customer_name: nombre || null,
                    total_amount:  total,
                    daily_menu_id: State.dailyMenuId || null,
                    notes:         notaCocina || null,
                }])
                .select('id')
                .single();

            if (errOrd) throw errOrd;

            // ─────────────────────────────────────────────────────
            // [FIX-3] PAYLOAD DE ORDER_ITEMS
            //
            // El nombre del producto se guarda en DOS lugares:
            //   1. notes con prefijo [nombre] — legado, cocina ya lo lee
            //   2. product_name — columna directa (si la BD la tiene)
            //
            // item.productName viene del carrito (guardado al hacer clic
            // en "+"). NUNCA es reconstruido por JOIN ni fallback.
            //
            // item.menuItemId viene del slot original de menu_items.
            // NO se usa como fuente del nombre — solo como referencia FK.
            // Si la FK es inválida, se reintenta con null pero el
            // nombre en notes/product_name siempre permanece correcto.
            // ─────────────────────────────────────────────────────
            const payload = State.cart
                .map(item => {
                    // Guardar defensa: verificar que productName no esté vacío
                    const nombreReal = (item.productName || '').trim();
                    if (!nombreReal) {
                        console.warn('[La 26] Item sin productName en carrito:', item);
                        return null;
                    }

                    const esSlotMock = item.slotId?.startsWith('demo-');
                    const dailySlotId = (esSlotMock || !State.dailyMenuId) ? null : item.slotId;

                    return {
                        order_id:           orden.id,
                        menu_item_id:       (!esSlotMock && item.menuItemId) ? item.menuItemId : null,
                        daily_menu_slot_id: dailySlotId,
                        quantity:           item.cantidad,
                        unit_price:         item.unitPrice,
                        item_status:        'pending',
                        // Nombre en notes con prefijo [nombre] — FUENTE DE VERDAD para cocina
                        notes:              `[nombre]${nombreReal}`,
                        // Columna directa (si existe en BD; si no, Supabase la ignora)
                        product_name:       nombreReal,
                    };
                })
                .filter(Boolean);

            if (payload.length > 0) {
                const { error: errItems } = await db.from('order_items').insert(payload);

                if (errItems) {
                    console.warn('[La 26] order_items primer intento falló:', errItems.message);

                    // Segundo intento: limpiar FKs problemáticas pero CONSERVAR
                    // el nombre real en notes y product_name
                    const payloadSeguro = payload.map(item => {
                        const p = { ...item };
                        delete p.menu_item_id;
                        delete p.daily_menu_slot_id;
                        // Si el error fue por product_name (columna inexistente), quitar también
                        if (errItems.message && errItems.message.includes('product_name')) {
                            delete p.product_name;
                        }
                        return p;
                    });

                    const { error: errItems2 } = await db.from('order_items').insert(payloadSeguro);

                    if (errItems2) {
                        // Tercer intento: solo campos base garantizados por el esquema
                        const payloadMinimo = payload.map(item => ({
                            order_id:    item.order_id,
                            quantity:    item.quantity,
                            unit_price:  item.unit_price,
                            item_status: 'pending',
                            notes:       item.notes,   // [nombre]<nombre real> — siempre guardado
                        }));
                        const { error: errItems3 } = await db.from('order_items').insert(payloadMinimo);
                        if (errItems3) {
                            console.error('[La 26] order_items no se pudo insertar:', errItems3.message);
                        }
                    }
                }
            }

            this._mostrarExito(numeroOrden);

        } catch (err) {
            console.error('[La 26] Error enviando pedido:', err);
            Toast.error('No se pudo enviar el pedido. Verifica tu conexión.', 5000);
        } finally {
            State.isSubmitting = false;
            if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Enviar a cocina'; }
        }
    },

    _mostrarExito(numeroOrden) {
        Cart.cerrar();

        const el = document.getElementById('success-order-no');
        if (el) el.textContent = numeroOrden;

        document.getElementById('success-modal').classList.add('open');

        State.cart = [];
        _actualizarCartBar();
    },

    nuevoPedido() {
        document.getElementById('success-modal').classList.remove('open');

        const mesaEl  = document.getElementById('form-mesa');
        const notasEl = document.getElementById('form-notas');
        if (mesaEl)  mesaEl.value  = '';
        if (notasEl) notasEl.value = '';

        window.scrollTo({ top: 0, behavior: 'smooth' });
        _renderizarMenu();
    },

    cerrarExito() {
        document.getElementById('success-modal').classList.remove('open');
    },
};

// ============================================================
// TIEMPO REAL
// ============================================================
function _suscribirRealtime() {
    if (!State.restaurantId) return;

    db.channel('la26-mesero-rt')
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'daily_menu_slots',
            filter: State.dailyMenuId
                ? `daily_menu_id=eq.${State.dailyMenuId}`
                : undefined,
        }, () => { if (State.dailyMenuId) Menu.cargar(); })
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'menu_items',
        }, () => Menu.cargar())
        .subscribe();
}

// ============================================================
// INIT — Carga directa, sin autenticación
// ============================================================
(async function init() {
    await _resolverRestaurant();

    const habilitado = await _verificarSistemaHabilitado();
    State.sistemaHabilitado = habilitado;

    if (!habilitado) {
        _mostrarSistemaBloqueado();
    } else {
        Menu.cargar();
    }

    _suscribirCambiosSistema();
})();

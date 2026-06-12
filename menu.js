// ============================================================
// RESTAURANTE LA 26 — PANEL DE MESERO
// menu.js · Versión 7.4.2
//
// ── DEPENDENCIA REQUERIDA EN EL HTML (antes de este script) ──
//   <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
//
// CAMBIOS v7.4.2 (patches aplicados sobre v7.4.1):
//  [FIX-PORCIONES-CRITICO]
//    Order.enviar(): el descuento de porciones ya NO depende
//    exclusivamente de La26Core. Se agrega _descontarPorciones()
//    como función directa sobre Supabase (usando `db`) que se
//    ejecuta SIEMPRE después de insertar los order_items.
//    La26Core sigue llamándose en paralelo si está disponible,
//    pero nunca es el único camino. Esto resuelve el escenario
//    donde menu.html no carga la26-core.js.
//
//  [FIX-PORCIONES-FILTRO]
//    _descontarPorciones(): filtra correctamente por menuItemId
//    no-null Y disponibilidad del slot (porciones < 999).
//    Solo descuenta ítems que tienen control real de porciones
//    (portions_today != null en la BD). Usa UPDATE con
//    decrement seguro: portions_today - cantidad, con mínimo 0
//    via GREATEST(portions_today - cantidad, 0).
//
//  [FIX-PORCIONES-OPTIMISTIC]
//    Después del descuento en BD, actualiza State.slots en
//    memoria para que la UI refleje el nuevo stock sin esperar
//    el ciclo de realtime.
//
// CAMBIOS v7.4.1 (patches aplicados sobre v7.4):
//  [PATCH-1] Order.enviar(): llama La26Core.descontarPorcionesOrden
//            y La26Core.ajustarInventarioPorItems después de insertar
//            los order_items. Silencioso si La26Core no está disponible.
//
//  [PATCH-2] init(): se suscribe a La26Core.on('onMenuItemChange')
//            y La26Core.on('onOrderChange') para actualizaciones
//            en tiempo real sin recargar todo el menú.
//
//  [PATCH-3] EditarPedido.guardar(): delega a La26Core.guardarEdicionAdmin
//            para control de inventario consistente con admin.
//            Incluye _guardarLegacy() como fallback sin La26Core.
//
// CAMBIOS v7.4:
//  [ADD-SESION]      Sesión de mesero por nombre (sessionStorage).
//  [ADD-MEDIANOCHE]  Reset automático del historial a las 00:00.
//  [DEL-VENTA]       Stats row solo muestra Total, Pendientes, Entregados.
//  [ADD-EDITAR]      Módulo EditarPedido completo.
//
// CAMBIOS v7.3:
//  [ADD-HISTORIAL] Módulo Hist integrado directamente en este archivo.
//
// CAMBIOS v7.2:
//  [ADD-DIRECCION] Campo de dirección en pedidos a domicilio.
//
// CAMBIOS v7.1:
//  [FIX-MESA] _resolverTableId sin fallback a Mesa 1.
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
    protein:        { label: 'Proteína con Salsa', icono: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><path d="M18 6c0-2.21-2.69-4-6-4S6 3.79 6 6c0 1.68.96 3.14 2.41 3.76L6 22h12l-2.41-12.24C16.96 9.14 18 7.68 18 6z"/></svg>', orden: 1 },
    side:           { label: 'Principio',          icono: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="M17 12h3"/></svg>', orden: 2 },
    drink:          { label: 'Bebida',             icono: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><path d="M8 2h8l1 10H7L8 2z"/><path d="M7 12c0 5 2 8 5 8s5-3 5-8"/></svg>', orden: 3 },
    a_la_carte:     { label: 'A la Carta',         icono: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', orden: 4 },
    executive_lunch:{ label: 'Menú Ejecutivo',     icono: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><path d="M3 2h18v6H3z"/><path d="M3 8v14h18V8"/><path d="M12 12h.01"/></svg>', orden: 5 },
    dessert:        { label: 'Postre',             icono: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2 1 2 1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/></svg>', orden: 6 },
};

const ITEM_TYPES_VALIDOS = ['executive_lunch','a_la_carte','drink','dessert','side'];

// Estados que permiten edición
const ESTADOS_EDITABLES = ['pending', 'preparing', 'confirmed'];
// Estados de ítem que NO se pueden eliminar
const ITEM_ESTADOS_NO_ELIMINABLES = ['preparing', 'delivered'];

// ============================================================
// ESTADO GLOBAL
// ============================================================
const State = {
    restaurantId:    null,
    slots:           [],
    cart:            [],
    filtro:          'todos',
    isSubmitting:    false,
    realtimeChannel: null,
};

// ============================================================
// ═══ SESIÓN DE MESERO ═══
// ============================================================
const Sesion = {
    KEY: 'la26_mesero_nombre',

    obtener() {
        return sessionStorage.getItem(this.KEY) || null;
    },

    guardar(nombre) {
        const n = (nombre || '').trim();
        if (!n) return false;
        sessionStorage.setItem(this.KEY, n);
        return true;
    },

    cerrar() {
        sessionStorage.removeItem(this.KEY);
    },

    label() {
        const n = this.obtener();
        return n ? n : '—';
    },

    async requerir() {
        if (this.obtener()) {
            _actualizarBannerMesero();
            return;
        }
        await this._mostrarPrompt();
        _actualizarBannerMesero();
    },

    _mostrarPrompt() {
        return new Promise((resolve) => {
            const overlay = document.getElementById('sesion-overlay');
            const input   = document.getElementById('sesion-input');
            const btn     = document.getElementById('sesion-btn');
            const errEl   = document.getElementById('sesion-error');
            if (!overlay) { resolve(); return; }

            overlay.style.display = 'flex';
            if (input) { input.value = ''; setTimeout(() => input.focus(), 120); }
            if (errEl) errEl.style.display = 'none';

            const confirmar = () => {
                const val = (input?.value || '').trim();
                if (!val) {
                    if (errEl) { errEl.textContent = 'Ingresa tu nombre para continuar.'; errEl.style.display = 'block'; }
                    input?.focus();
                    return;
                }
                this.guardar(val);
                overlay.style.display = 'none';
                resolve();
            };

            if (btn) btn.onclick = confirmar;
            if (input) {
                input.onkeydown = (e) => { if (e.key === 'Enter') confirmar(); };
            }
        });
    },

    cambiar() {
        const overlay = document.getElementById('sesion-overlay');
        const input   = document.getElementById('sesion-input');
        const errEl   = document.getElementById('sesion-error');
        if (!overlay) return;
        this.cerrar();
        if (input) input.value = '';
        if (errEl) errEl.style.display = 'none';
        overlay.style.display = 'flex';
        setTimeout(() => input?.focus(), 120);

        const btn = document.getElementById('sesion-btn');
        if (btn) {
            btn.onclick = () => {
                const val = (input?.value || '').trim();
                if (!val) {
                    if (errEl) { errEl.textContent = 'Ingresa tu nombre para continuar.'; errEl.style.display = 'block'; }
                    input?.focus();
                    return;
                }
                this.guardar(val);
                overlay.style.display = 'none';
                _actualizarBannerMesero();
                HistState.cargado = false;
                HistState.pedidos = [];
                if (typeof Tabs !== 'undefined' && Tabs.actual === 'historial') {
                    Hist.cargar();
                }
            };
        }
    },
};

function _actualizarBannerMesero() {
    const el = document.getElementById('mesero-nombre-display');
    if (el) el.textContent = Sesion.label();
}

// ============================================================
// RESET AUTOMÁTICO A MEDIANOCHE
// ============================================================
function _programarResetMedianoche() {
    const ahora  = new Date();
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    manana.setHours(0, 0, 5, 0);
    const ms = manana - ahora;

    setTimeout(() => {
        HistState.cargado = false;
        HistState.pedidos = [];
        if (typeof Tabs !== 'undefined' && Tabs.actual === 'historial') {
            Hist.cargar();
        }
        _programarResetMedianoche();
    }, ms);
}

// ============================================================
// TOAST
// ============================================================
const Toast = (function() {
    function show(msg, tipo = 'info', dur = 3800) {
        const wrap = document.getElementById('toast-wrap');
        if (!wrap) return;
        const c = {
            ok:    { bg:'#f5f7f0', border:'rgba(74,103,65,0.35)',  text:'#2e4028', dot:'#4a6741' },
            error: { bg:'#fdf5f3', border:'rgba(192,80,60,0.30)',  text:'#6b2a1e', dot:'#c0503c' },
            info:  { bg:'#f5f7f0', border:'rgba(74,103,65,0.25)',  text:'#3a4a38', dot:'#4a6741' },
        }[tipo] || {};

        const t = document.createElement('div');
        Object.assign(t.style, {
            display:'flex', alignItems:'center', gap:'9px',
            background:c.bg, border:`1.5px solid ${c.border}`,
            borderRadius:'999px', padding:'10px 20px 10px 14px',
            boxShadow:'0 4px 20px rgba(0,0,0,0.10)',
            fontSize:'13.5px', fontFamily:"'DM Sans',sans-serif",
            fontWeight:'500', color:c.text,
            pointerEvents:'auto', opacity:'0',
            transform:'translateY(-8px)',
            transition:'opacity .28s ease, transform .28s ease',
            maxWidth:'calc(100vw - 32px)',
        });
        const dot = document.createElement('span');
        Object.assign(dot.style,{ width:'7px',height:'7px',borderRadius:'50%',background:c.dot,flexShrink:'0',display:'block' });
        const txt = document.createElement('span');
        txt.textContent = msg;
        t.appendChild(dot); t.appendChild(txt);
        wrap.appendChild(t);

        requestAnimationFrame(() => requestAnimationFrame(() => {
            t.style.opacity = '1'; t.style.transform = 'translateY(0)';
        }));
        const timer = setTimeout(() => {
            t.style.opacity = '0'; t.style.transform = 'translateY(-8px)';
            setTimeout(() => t.remove(), 300);
        }, dur);
        t.onclick = () => { clearTimeout(timer); t.remove(); };
    }
    return {
        ok:    (m,ms) => show(m,'ok',ms),
        error: (m,ms) => show(m,'error',ms),
        info:  (m,ms) => show(m,'info',ms),
    };
})();

// ============================================================
// HELPERS
// ============================================================
function formatCOP(v) {
    return '$' + Math.round(v || 0).toLocaleString('es-CO');
}
function todayISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}
function generarNumeroOrden() {
    return `LA26-${Math.floor(10000000 + Math.random() * 89999999)}`;
}
function calcularTotal() {
    return State.cart.reduce((acc, item) => {
        const slot = State.slots.find(s => s.id === item.slotId);
        return acc + (slot ? slot.precio * item.cantidad : 0);
    }, 0);
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
// ============================================================
let _restaurantResolving = false;

async function _resolverRestaurant() {
    if (State.restaurantId || _restaurantResolving) return;
    _restaurantResolving = true;
    try {
        const { data: r1, error: e1 } = await db
            .from('restaurants').select('id')
            .eq('slug', RESTAURANT_SLUG).maybeSingle();
        if (e1) console.warn('[La 26] restaurants query error:', e1.message);
        if (r1?.id) { State.restaurantId = r1.id; return; }

        const { data: r2 } = await db.from('restaurants').select('id').limit(1).maybeSingle();
        if (r2?.id) { State.restaurantId = r2.id; return; }

        const { data: r3 } = await db
            .from('restaurants')
            .insert([{ name: 'Restaurante la 26', slug: RESTAURANT_SLUG }])
            .select('id').single();
        if (r3?.id) State.restaurantId = r3.id;
    } catch (err) {
        console.warn('[La 26] Error resolviendo restaurant_id:', err);
    } finally {
        _restaurantResolving = false;
    }
}

// ============================================================
// RESOLVER TABLE_ID  (v7.1 — sin fallback a Mesa 1)
// ============================================================
async function _resolverTableId(modalidad, mesa) {
    if (!State.restaurantId) await _resolverRestaurant();
    if (!State.restaurantId) return null;

    if (modalidad === 'mesa') {
        const mesaNum = parseInt(mesa);

        if (!isNaN(mesaNum) && mesaNum > 0) {
            const { data: porNum } = await db.from('tables').select('id')
                .eq('restaurant_id', State.restaurantId).eq('number', mesaNum).maybeSingle();
            if (porNum?.id) return porNum.id;
        }

        if (mesa) {
            const { data: porLabel } = await db.from('tables').select('id')
                .eq('restaurant_id', State.restaurantId)
                .ilike('label', `%${mesa}%`)
                .not('label','ilike','%llevar%')
                .not('label','ilike','%domicilio%')
                .not('label','ilike','%takeaway%')
                .maybeSingle();
            if (porLabel?.id) return porLabel.id;
        }

        const mesaNumFinal = (!isNaN(parseInt(mesa)) && parseInt(mesa) > 0) ? parseInt(mesa) : null;
        if (mesaNumFinal) {
            try {
                const { data: nueva, error: errNueva } = await db.from('tables')
                    .insert([{
                        restaurant_id: State.restaurantId,
                        number: mesaNumFinal,
                        label: `Mesa ${mesaNumFinal}`,
                        qr_code: `MESA-${State.restaurantId}-${mesaNumFinal}-${Date.now()}`,
                        capacity: 4, status: 'available',
                    }]).select('id').single();
                if (nueva?.id) return nueva.id;
                if (errNueva?.code === '23505') {
                    const { data: reintento } = await db.from('tables').select('id')
                        .eq('restaurant_id', State.restaurantId).eq('number', mesaNumFinal).maybeSingle();
                    if (reintento?.id) return reintento.id;
                }
            } catch (e) {
                console.warn(`[La 26] No se pudo crear Mesa ${mesaNumFinal}:`, e.message);
            }
        }
        return null;
    }

    // Para llevar / domicilio
    const { data: mv0 } = await db.from('tables').select('id')
        .eq('restaurant_id', State.restaurantId).eq('number', 0).maybeSingle();
    if (mv0?.id) return mv0.id;

    const { data: mvL } = await db.from('tables').select('id')
        .eq('restaurant_id', State.restaurantId).ilike('label','%para llevar%').maybeSingle();
    if (mvL?.id) return mvL.id;

    const { data: mn } = await db.from('tables').insert([{
        restaurant_id: State.restaurantId, number: 0,
        label: 'Para Llevar / Domicilio',
        qr_code: `VIRTUAL-TAKEAWAY-${State.restaurantId}-${Date.now()}`,
        capacity: 99, status: 'available',
    }]).select('id').single();
    return mn?.id || null;
}

// ============================================================
// MENÚ
// ============================================================
const Menu = {
    async cargar() {
        _mostrarEstado('loader');
        if (!State.restaurantId) await _resolverRestaurant();
        if (!State.restaurantId) {
            _mostrarEstado('error', 'No se pudo identificar el restaurante.');
            return;
        }
        try {
            const { data: dataRaw, error } = await db
                .from('menu_items')
                .select('id, name, price, item_type, is_active, description, portions_today')
                .eq('restaurant_id', State.restaurantId)
                .eq('is_active', true)
                .order('item_type', { ascending: true })
                .order('name',      { ascending: true });

            const TIPOS_ACEPTADOS = [...ITEM_TYPES_VALIDOS, 'protein'];
            const data = dataRaw ? dataRaw.filter(i => TIPOS_ACEPTADOS.includes(i.item_type)) : dataRaw;

            if (error) throw error;
            if (!data || data.length === 0) { _activarModoDemo(); return; }

            State.slots = data.map(item => {
                const tienePortions = item.portions_today !== null && item.portions_today !== undefined;
                const porciones     = tienePortions ? Number(item.portions_today) : 999;
                const disponible    = item.is_active === true && porciones > 0;
                return {
                    id: item.id, menuItemId: item.id,
                    nombre: item.name, precio: Number(item.price) || 0,
                    descripcion: item.description || '',
                    itemType: CATEGORIAS[item.item_type] ? item.item_type : 'a_la_carte',
                    porciones, disponible,
                    // [FIX-PORCIONES] Guardar si tiene control real de porciones
                    tieneControlPorciones: tienePortions,
                };
            });

            _renderizarMenu();
            _mostrarEstado('menu');
            _suscribirRealtimeMenu();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        } catch (err) {
            _mostrarEstado('error', `No se pudo cargar la carta: ${err.message || 'error de red'}`);
        }
    },
};

function _mostrarEstado(estado, msg = '') {
    const loader   = document.getElementById('app-loader');
    const error    = document.getElementById('app-error');
    const sections = document.getElementById('menu-sections');
    if (loader)   loader.style.display   = estado === 'loader' ? 'flex'  : 'none';
    if (error)    error.style.display    = estado === 'error'  ? 'flex'  : 'none';
    if (sections) sections.style.display = estado === 'menu'   ? 'block' : 'none';
    if (estado === 'error') {
        if (loader) loader.style.display = 'none';
        const el = document.getElementById('error-msg');
        if (el) el.textContent = msg || 'Error desconocido. Recarga la página.';
    }
}

function _activarModoDemo() {
    State.slots = [
        { id:'demo-p1', menuItemId:null, nombre:'Pechuga a la Plancha con Salsa Criolla', precio:16000, descripcion:'Pechuga jugosa bañada en salsa criolla.', itemType:'protein', porciones:12, disponible:true,  tieneControlPorciones:false },
        { id:'demo-p2', menuItemId:null, nombre:'Tilapia Frita con Salsa de Ajo',         precio:18000, descripcion:'Tilapia frita con salsa de ajo y limón.',  itemType:'protein', porciones:8,  disponible:true,  tieneControlPorciones:false },
        { id:'demo-p3', menuItemId:null, nombre:'Cerdo al Horno con Salsa BBQ',           precio:17000, descripcion:'Lomo de cerdo con salsa BBQ artesanal.',   itemType:'protein', porciones:0,  disponible:false, tieneControlPorciones:false },
        { id:'demo-s1', menuItemId:null, nombre:'Arroz Blanco',                           precio:0,     descripcion:'Acompañamiento del almuerzo.',             itemType:'side',    porciones:30, disponible:true,  tieneControlPorciones:false },
        { id:'demo-s2', menuItemId:null, nombre:'Fríjoles Rojos con Hogao',              precio:0,     descripcion:'Fríjoles cocinados a fuego lento.',         itemType:'side',    porciones:25, disponible:true,  tieneControlPorciones:false },
        { id:'demo-d1', menuItemId:null, nombre:'Jugo Natural del Día',                  precio:3000,  descripcion:'Fruta fresca de temporada.',                itemType:'drink',   porciones:30, disponible:true,  tieneControlPorciones:false },
        { id:'demo-d2', menuItemId:null, nombre:'Limonada de Panela',                    precio:3500,  descripcion:'Limón con panela orgánica.',                itemType:'drink',   porciones:25, disponible:true,  tieneControlPorciones:false },
    ];
    _renderizarMenu();
    _mostrarEstado('menu');
    if (typeof lucide !== 'undefined') lucide.createIcons();
} {
    const bar = document.getElementById('cats-bar');
    if (!bar) return;
    bar.innerHTML = '';

    const btnTodos = document.createElement('button');
    btnTodos.className   = `cat-btn${State.filtro === 'todos' ? ' active' : ''}`;
    btnTodos.textContent = 'Todos';
    btnTodos.onclick     = () => _cambiarFiltro('todos');
    bar.appendChild(btnTodos);

    const tipos = [...new Set(State.slots.map(s => s.itemType))].filter(t => CATEGORIAS[t]);
    tipos.sort((a,b) => (CATEGORIAS[a]?.orden||99) - (CATEGORIAS[b]?.orden||99))
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
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _renderizarMenu() {
    _renderizarCatsBar();
    const sections = document.getElementById('menu-sections');
    if (!sections) return;
    sections.innerHTML = '';
    const lista = slotsFiltrados();
    if (!lista || lista.length === 0) {
        sections.innerHTML = `<div class="empty-state"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg></div><p>No hay platos disponibles<br>en esta categoría.</p></div>`;
        return;
    }
    const grupos = {};
    lista.forEach(slot => {
        const tipo = CATEGORIAS[slot.itemType] ? slot.itemType : 'a_la_carte';
        if (!grupos[tipo]) grupos[tipo] = [];
        grupos[tipo].push(slot);
    });
    Object.keys(grupos)
        .sort((a,b) => (CATEGORIAS[a]?.orden||99) - (CATEGORIAS[b]?.orden||99))
        .forEach((tipo, secIdx) => {
            const cfg = CATEGORIAS[tipo];
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
    const pocas      = disponible && slot.porciones > 0 && slot.porciones < 999 && slot.porciones <= 5;
    const enCarrito  = State.cart.find(c => c.slotId === slot.id);
    const qty        = enCarrito ? enCarrito.cantidad : 0;

    let badgeHTML = '';
    if (!disponible) badgeHTML = `<span class="badge-agotado">Agotado</span>`;
    else if (pocas)  badgeHTML = `<span class="badge-pocas">¡Solo quedan ${slot.porciones}!</span>`;

    const precioHTML = slot.precio > 0
        ? `<span class="plate-price">${formatCOP(slot.precio)}</span>`
        : `<span class="plate-price incluido">Incluido</span>`;

    let ctrlHTML = '';
    if (disponible) {
        ctrlHTML = qty === 0
            ? `<button class="btn-add" onclick="Cart.agregar('${slot.id}')" aria-label="Agregar ${slot.nombre}">+</button>`
            : `<div class="qty-chip">
                   <button onclick="Cart.cambiar('${slot.id}',-1)" aria-label="Quitar">−</button>
                   <span>${qty}</span>
                   <button onclick="Cart.cambiar('${slot.id}',+1)" aria-label="Agregar">+</button>
               </div>`;
    }

    const card = document.createElement('div');
    card.id        = `tarjeta-${slot.id}`;
    card.className = `plate-card${!disponible ? ' agotado' : ''} fade-up`;
    card.innerHTML = `
        <div class="plate-info">
            <p class="plate-name">${slot.nombre}</p>
            ${slot.descripcion ? `<p class="plate-desc">${slot.descripcion}</p>` : ''}
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;">
                ${precioHTML}${badgeHTML}
            </div>
        </div>
        <div style="flex-shrink:0;">${ctrlHTML}</div>`;
    return card;
}

function _refrescarTarjeta(slotId) {
    const slot = State.slots.find(s => s.id === slotId);
    if (!slot) return;
    const vieja = document.getElementById(`tarjeta-${slotId}`);
    if (vieja) vieja.replaceWith(_crearTarjeta(slot));
}

// ============================================================
// CARRITO
// ============================================================
const Cart = {
    agregar(slotId) {
        const slot = State.slots.find(s => s.id === slotId);
        if (!slot || !slot.disponible) return;
        const existente = State.cart.find(c => c.slotId === slotId);
        if (existente) {
            if (slot.porciones < 999 && existente.cantidad >= slot.porciones) {
                Toast.error(`Solo quedan ${slot.porciones} porciones de "${slot.nombre}".`);
                return;
            }
            existente.cantidad++;
        } else {
            State.cart.push({ slotId, cantidad: 1 });
        }
        _refrescarTarjeta(slotId);
        _actualizarCartBar();
    },

    cambiar(slotId, delta) {
        const slot = State.slots.find(s => s.id === slotId);
        if (!slot) return;
        const idx = State.cart.findIndex(c => c.slotId === slotId);
        if (idx === -1) return;
        if (delta > 0 && slot.porciones < 999 && State.cart[idx].cantidad + delta > slot.porciones) {
            Toast.error(`Solo quedan ${slot.porciones} porciones.`);
            return;
        }
        const nueva = State.cart[idx].cantidad + delta;
        if (nueva <= 0) State.cart.splice(idx, 1);
        else            State.cart[idx].cantidad = nueva;
        _refrescarTarjeta(slotId);
        _actualizarCartBar();
        const modal = document.getElementById('order-modal');
        if (modal?.classList.contains('open')) Cart._renderSummary();
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
            listEl.innerHTML = `<div style="text-align:center;padding:36px 0;"><p style="font-size:13px;color:var(--ink-ghost);">Tu pedido está vacío.</p></div>`;
            if (totalEl) totalEl.textContent = '$0';
            return;
        }
        State.cart.forEach(item => {
            const slot = State.slots.find(s => s.id === item.slotId);
            if (!slot) return;
            const row = document.createElement('div');
            row.className = 'summary-row';
            row.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <p class="summary-name">${slot.nombre}</p>
                    <p class="summary-qty">${item.cantidad} × ${slot.precio > 0 ? formatCOP(slot.precio) : 'Incluido'}</p>
                </div>
                <span class="summary-price">${slot.precio > 0 ? formatCOP(slot.precio * item.cantidad) : '—'}</span>`;
            listEl.appendChild(row);
        });
        if (totalEl) totalEl.textContent = formatCOP(calcularTotal());
    },
};

function _actualizarCartBar() {
    const qty = calcularCantidadTotal();
    const bar     = document.getElementById('cart-bar');
    const countEl = document.getElementById('cart-count');
    const totalEl = document.getElementById('cart-total');
    if (countEl) countEl.textContent = qty;
    if (totalEl) totalEl.textContent = formatCOP(calcularTotal());
    if (bar) {
        if (qty > 0) bar.classList.add('visible');
        else         bar.classList.remove('visible');
    }
}

// ============================================================
// [FIX-PORCIONES-CRITICO] DESCUENTO DIRECTO DE PORCIONES
// ============================================================
// Esta función se ejecuta SIEMPRE después de confirmar una orden,
// independientemente de si La26Core está disponible o no.
// Solo descuenta ítems que tienen control real de porciones
// (tieneControlPorciones === true, es decir portions_today != null en BD).
//
// Usa una actualización atómica segura:
//   portions_today = GREATEST(portions_today - cantidad, 0)
// para nunca ir a negativo.
// ============================================================
async function _descontarPorciones(cartSnapshot) {
    // cartSnapshot = copia del carrito en el momento de confirmar
    // [{slotId, cantidad}]

    const itemsConControl = cartSnapshot
        .map(item => {
            const slot = State.slots.find(s => s.id === item.slotId);
            if (!slot) return null;
            // Solo descuenta si tiene menuItemId real (no demo) y control de porciones
            if (!slot.menuItemId || !slot.tieneControlPorciones) return null;
            return { menuItemId: slot.menuItemId, cantidad: item.cantidad, slot };
        })
        .filter(Boolean);

    if (itemsConControl.length === 0) {
        // No hay ítems con control de porciones — no hay nada que descontar
        return;
    }

    // Agrupar por menuItemId por si el mismo ítem aparece dos veces en el carrito
    const agrupado = {};
    for (const it of itemsConControl) {
        if (!agrupado[it.menuItemId]) {
            agrupado[it.menuItemId] = { menuItemId: it.menuItemId, cantidad: 0, slot: it.slot };
        }
        agrupado[it.menuItemId].cantidad += it.cantidad;
    }

    const promesas = Object.values(agrupado).map(async ({ menuItemId, cantidad, slot }) => {
        try {
            // Leer el valor actual de portions_today primero
            const { data: actual, error: errLeer } = await db
                .from('menu_items')
                .select('portions_today')
                .eq('id', menuItemId)
                .single();

            if (errLeer || !actual) {
                console.warn(`[La 26] No se pudo leer portions_today para ${slot.nombre}:`, errLeer?.message);
                return;
            }

            const porcionesActuales = Number(actual.portions_today) ?? 0;
            const nuevasPorciones   = Math.max(0, porcionesActuales - cantidad);

            const { error: errUpdate } = await db
                .from('menu_items')
                .update({
                    portions_today: nuevasPorciones,
                    // Si llega a 0, desactivar automáticamente
                    is_active: nuevasPorciones > 0,
                })
                .eq('id', menuItemId);

            if (errUpdate) {
                console.warn(`[La 26] Error descontando porciones de "${slot.nombre}":`, errUpdate.message);
                return;
            }

            // [FIX-PORCIONES-OPTIMISTIC] Actualizar State.slots en memoria inmediatamente
            // para que la UI refleje el stock correcto sin esperar el ciclo de realtime
            const idxSlot = State.slots.findIndex(s => s.id === slot.id);
            if (idxSlot !== -1) {
                State.slots[idxSlot].porciones   = nuevasPorciones;
                State.slots[idxSlot].disponible  = nuevasPorciones > 0;
                // Si se agotó, refrescar la tarjeta en la UI
                if (nuevasPorciones === 0) {
                    _refrescarTarjeta(slot.id);
                } else if (nuevasPorciones <= 5) {
                    // Actualizar badge de "pocas" si corresponde
                    _refrescarTarjeta(slot.id);
                }
            }

            console.info(`[La 26] ✓ Porciones descontadas: "${slot.nombre}" ${porcionesActuales} → ${nuevasPorciones}`);

        } catch (err) {
            // No cortar el flujo principal, solo loguear
            console.warn(`[La 26] Excepción al descontar porciones de "${slot.nombre}":`, err.message);
        }
    });

    // Ejecutar todos los descuentos en paralelo
    await Promise.allSettled(promesas);
}

// ============================================================
// ENVÍO DEL PEDIDO
// [FIX-PORCIONES-CRITICO] Se llama _descontarPorciones() SIEMPRE
// después de insertar los order_items, con la copia del carrito.
// La26Core sigue usándose como canal adicional si está disponible.
// ============================================================
const Order = {
    async enviar() {
        if (State.isSubmitting) return;
        if (State.cart.length === 0) { Toast.error('Agrega al menos un plato al pedido.'); return; }

        const btnEl       = document.getElementById('btn-enviar');
        const mesaEl      = document.getElementById('form-mesa');
        const nombreEl    = document.getElementById('form-nombre');
        const notasEl     = document.getElementById('form-notas');
        const direccionEl = document.getElementById('form-direccion');
        const modalidadEl = document.querySelector('input[name="form-modalidad"]:checked');

        const mesa      = (mesaEl?.value      || '').trim();
        const nombre    = (nombreEl?.value    || '').trim();
        const notas     = (notasEl?.value     || '').trim();
        const direccion = (direccionEl?.value || '').trim();
        const modalidad = modalidadEl?.value || 'mesa';

        if (modalidad === 'mesa' && !mesa) {
            mesaEl?.classList.add('error'); mesaEl?.focus();
            Toast.error('Indica el número de mesa.'); return;
        }
        mesaEl?.classList.remove('error');

        if (modalidad === 'domicilio' && !direccion) {
            direccionEl?.classList.add('error'); direccionEl?.focus();
            Toast.error('Indica la dirección de entrega.'); return;
        }
        direccionEl?.classList.remove('error');

        State.isSubmitting = true;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Enviando…'; }

        // [FIX-PORCIONES-CRITICO] Capturar snapshot del carrito ANTES de limpiarlo
        // para usarlo en _descontarPorciones() después de confirmar la orden.
        const cartSnapshot = State.cart.map(item => ({ ...item }));

        try {
            if (!State.restaurantId) await _resolverRestaurant();
            if (!State.restaurantId) throw new Error('No se pudo identificar el restaurante.');

            const tableId = await _resolverTableId(modalidad, mesa);
            let tableIdFinal = tableId;
            if (!tableIdFinal) {
                const { data: anyTable } = await db.from('tables').select('id')
                    .eq('restaurant_id', State.restaurantId).limit(1).maybeSingle();
                tableIdFinal = anyTable?.id || null;
            }
            if (!tableIdFinal) throw new Error('No hay mesas configuradas. Crea al menos una en el panel admin.');

            // Inyectar mesero en las notas
            const mesero = Sesion.obtener();
            let notaCocina = '';
            if (modalidad === 'mesa')           notaCocina = `[MESA] Mesa: ${mesa}`;
            else if (modalidad === 'llevar')    notaCocina = `[PARA LLEVAR] Cliente: ${nombre || 'Sin nombre'}`;
            else if (modalidad === 'domicilio') notaCocina = `[DOMICILIO] Cliente: ${nombre || 'Sin nombre'} | Dir: ${direccion}`;
            if (mesero) notaCocina += ` | Mesero: ${mesero}`;
            if (notas)  notaCocina += ` | Nota: ${notas}`;

            const numeroOrden = generarNumeroOrden();
            const total       = calcularTotal();

            const { data: orden, error: errOrd } = await db.from('orders').insert([{
                restaurant_id: State.restaurantId,
                table_id:      tableIdFinal,
                order_number:  numeroOrden,
                status:        'pending',
                customer_name: nombre || null,
                total_amount:  total,
                notes:         notaCocina || null,
            }]).select('id').single();
            if (errOrd) throw errOrd;

            const { data: todosItems } = await db.from('menu_items').select('id,name,item_type')
                .eq('restaurant_id', State.restaurantId).eq('is_active', true);
            const listaItems = todosItems || [];
            const fallbackId = listaItems[0]?.id || null;

            const payload = State.cart.map(item => {
                const slot = State.slots.find(s => s.id === item.slotId);
                if (!slot) return null;
                let menuItemId = slot.menuItemId;
                if (!menuItemId && listaItems.length > 0) {
                    const nb  = (slot.nombre || '').toLowerCase().trim();
                    const ex  = listaItems.find(m => m.name.toLowerCase().trim() === nb);
                    const par = !ex && listaItems.find(m => m.name.toLowerCase().includes(nb.split(' ')[0]));
                    menuItemId = ex?.id || par?.id || fallbackId;
                }
                return {
                    order_id: orden.id, menu_item_id: menuItemId,
                    quantity: item.cantidad, unit_price: slot.precio,
                    item_status: 'pending',
                    product_name: slot.nombre,
                    notes: `[nombre]${slot.nombre}`,
                };
            }).filter(Boolean);

            if (payload.length > 0) {
                const { error: errItems } = await db.from('order_items').insert(payload);
                if (errItems) {
                    if (errItems.code === '42703' || errItems.message?.includes('product_name')) {
                        const p2 = payload.map(({ product_name, ...rest }) => rest);
                        const { error: err2 } = await db.from('order_items').insert(p2);
                        if (err2) Toast.error('Pedido registrado pero ítems fallaron. Avisa al admin.', 6000);
                    } else {
                        Toast.error('Pedido registrado pero ítems fallaron. Avisa al admin.', 6000);
                    }
                }

                // ─────────────────────────────────────────────────────────
                // [FIX-PORCIONES-CRITICO] DESCUENTO DIRECTO — SIEMPRE corre
                // No depende de La26Core. Usa `db` que ya está inicializado.
                // Ejecuta en background (no bloquea la pantalla de éxito).
                // ─────────────────────────────────────────────────────────
                _descontarPorciones(cartSnapshot).catch(err =>
                    console.warn('[La 26] Error en descuento de porciones (background):', err.message)
                );

                // La26Core solo para inventario de insumos — NO porciones
                // (porciones ya las maneja _descontarPorciones arriba)
                if (window.La26Core) {
                    La26Core.ajustarInventarioPorItems(
                        payload.map(p => ({ menu_item_id: p.menu_item_id, quantity: p.quantity, notes: p.notes })),
                        1
                    ).catch(e => console.warn('[menu.js] La26Core.ajustarInventarioPorItems silencioso:', e.message));
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
        if (HistState.cargado) Hist.cargar();
    },

    nuevoPedido() {
        document.getElementById('success-modal').classList.remove('open');
        const notasEl     = document.getElementById('form-notas');
        const direccionEl = document.getElementById('form-direccion');
        if (notasEl)     notasEl.value     = '';
        if (direccionEl) direccionEl.value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        _renderizarMenu();
    },

    cerrarExito() {
        document.getElementById('success-modal').classList.remove('open');
    },
};

// ============================================================
// REALTIME — menu_items
// ============================================================
function _suscribirRealtimeMenu() {
    if (!State.restaurantId) return;
    if (State.realtimeChannel) { db.removeChannel(State.realtimeChannel); State.realtimeChannel = null; }

    State.realtimeChannel = db
        .channel(`la26-menu-v742-${State.restaurantId}`)
        .on('postgres_changes',{ event:'UPDATE', schema:'public', table:'menu_items',
            filter:`restaurant_id=eq.${State.restaurantId}` },
            (payload) => _actualizarSlotDesdeRealtime(payload.new))
        .on('postgres_changes',{ event:'INSERT', schema:'public', table:'menu_items',
            filter:`restaurant_id=eq.${State.restaurantId}` },
            () => Menu.cargar())
        .on('postgres_changes',{ event:'DELETE', schema:'public', table:'menu_items' },
            () => Menu.cargar())
        .subscribe();
}

function _actualizarSlotDesdeRealtime(item) {
    if (!item?.id) return;
    const idx = State.slots.findIndex(s => s.id === item.id);
    if (idx === -1) { Menu.cargar(); return; }

    const tienePortions = item.portions_today !== null && item.portions_today !== undefined;
    const porciones     = tienePortions ? Number(item.portions_today) : 999;
    const disponible    = item.is_active === true && porciones > 0;

    State.slots[idx] = {
        ...State.slots[idx],
        nombre:    item.name,
        precio:    Number(item.price) || 0,
        porciones,
        disponible,
        tieneControlPorciones: tienePortions,
    };
    _refrescarTarjeta(item.id);

    if (!disponible) {
        const idx2 = State.cart.findIndex(c => c.slotId === item.id);
        if (idx2 !== -1) {
            const nombre = State.slots[idx].nombre;
            State.cart.splice(idx2, 1);
            _actualizarCartBar();
            Toast.error(`"${nombre}" se agotó y fue removido de tu pedido.`, 5000);
        }
    }
}

// ============================================================
// ═══ MÓDULO HISTORIAL (v7.4) ═══
// ============================================================

const HistState = {
    pedidos:         [],
    filtro:          'todos',
    cargado:         false,
    cargando:        false,   // <-- agregar esta línea
    realtimeChannel: null,
};

function _parsearNota(notes) {
    const n = notes || '';
    let tipo = 'mesa', destino = '', cliente = '', direccion = '', nota = '', mesero = '';

    if (n.startsWith('[MESA]')) {
        tipo = 'mesa';
        const m = n.match(/Mesa:\s*([^|]+)/);
        destino = m ? `Mesa ${m[1].trim()}` : 'Mesa';
    } else if (n.startsWith('[PARA LLEVAR]')) {
        tipo = 'llevar'; destino = 'Para Llevar';
        const m = n.match(/Cliente:\s*([^|]+)/);
        cliente = m ? m[1].trim() : '';
    } else if (n.startsWith('[DOMICILIO]')) {
        tipo = 'domicilio'; destino = 'Domicilio';
        const mc = n.match(/Cliente:\s*([^|]+)/);
        const md = n.match(/Dir:\s*([^|]+)/);
        cliente   = mc ? mc[1].trim() : '';
        direccion = md ? md[1].trim() : '';
    } else {
        tipo = 'mesa'; destino = n || 'Sin datos';
    }

    const mm = n.match(/Mesero:\s*([^|]+)/);
    mesero = mm ? mm[1].trim() : '';

    const mn = n.match(/Nota:\s*(.+)$/);
    nota = mn ? mn[1].trim() : '';
    return { tipo, destino, cliente, direccion, nota, mesero };
}

function _horaCorta(isoStr) {
    if (!isoStr) return '';
    try {
        return new Date(isoStr).toLocaleTimeString('es-CO',
            { hour:'2-digit', minute:'2-digit', timeZone:'America/Bogota' });
    } catch { return ''; }
}

const Hist = {

    async cargar() {
        if (HistState.cargando) return;   // semáforo — evita concurrencia
        HistState.cargando = true;
        _histSetLoader(true);
        if (!State.restaurantId) await _resolverRestaurant();
        if (!State.restaurantId) {
            _histSetError('No se pudo identificar el restaurante.');
            HistState.cargando = false;
            return;
        }
        try {
            const hoy = todayISO();
            const { data: ordenes, error } = await db
                .from('orders')
                .select(`
                    id, order_number, status, customer_name,
                    total_amount, notes, created_at,
                    order_items (
                        id, quantity, unit_price, notes, item_status,
                        menu_items ( name )
                    )
                `)
                .eq('restaurant_id', State.restaurantId)
                .gte('created_at', `${hoy}T00:00:00`)
                .lte('created_at', `${hoy}T23:59:59`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const meseroActivo = Sesion.obtener();
            const todas = ordenes || [];
            HistState.pedidos = meseroActivo
                ? todas.filter(p => {
                    const { mesero } = _parsearNota(p.notes);
                    return mesero.toLowerCase() === meseroActivo.toLowerCase();
                })
                : todas;

            HistState.cargado = true;
            this._render();
            this._suscribirRealtime();
        } catch (err) {
            console.error('[Hist] Error:', err);
            _histSetError(`No se pudo cargar el historial: ${err.message}`);
        } finally {
            HistState.cargando = false;   // liberar semáforo siempre
        }
    },

    cargarSiNecesario() {
        if (HistState.cargado) {
            this._render();
        } else {
            this.cargar();
        }
    },

    async recargar() {
        const btn = document.getElementById('btn-refresh-hist');
        btn?.classList.add('spinning');
        await this.cargar();
        btn?.classList.remove('spinning');
        Toast.ok('Historial actualizado');
    },

    filtrar(valor, btnEl) {
        HistState.filtro = valor;
        document.querySelectorAll('.hfilt-btn').forEach(b => b.classList.remove('active'));
        btnEl.classList.add('active');
        this._render();
    },

    _pedidosFiltrados() {
        if (HistState.filtro === 'todos') return HistState.pedidos;
        return HistState.pedidos.filter(p => _parsearNota(p.notes).tipo === HistState.filtro);
    },

    _render() {
        const total      = HistState.pedidos.length;
        const pendientes = HistState.pedidos.filter(p => p.status === 'pending' || p.status === 'preparing').length;
        const entregados = HistState.pedidos.filter(p => p.status === 'delivered').length;

        const set = (id,v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
        set('st-total',      total);
        set('st-pendientes', pendientes);
        set('st-entregados', entregados);

        const badge = document.getElementById('badge-pendientes');
        if (badge) {
            badge.textContent = pendientes;
            badge.classList.toggle('visible', pendientes > 0);
        }

        const fechaEl = document.getElementById('hist-fecha');
        if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-CO',
            { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/Bogota' });

        const lista = document.getElementById('hist-lista');
        if (!lista) return;
        lista.innerHTML = '';

        const items = this._pedidosFiltrados();

        if (items.length === 0) {
            lista.innerHTML = `
                <div class="empty-state" style="padding:56px 28px;">
                    <div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg></div>
                    <p>${HistState.pedidos.length === 0
                        ? 'Aún no hay pedidos hoy.'
                        : 'No hay pedidos en esta categoría.'}</p>
                </div>`;
            return;
        }

        items.forEach((pedido, i) => {
            const card = _crearTarjetaPedido(pedido, i);
            lista.appendChild(card);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();

    _suscribirRealtime() {
        if (!State.restaurantId) return;

        // No recrear el canal si ya está activo — evita duplicados
        if (HistState.realtimeChannel) return;

        HistState.realtimeChannel = db
            .channel(`la26-hist-v742-${State.restaurantId}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'orders',
                filter: `restaurant_id=eq.${State.restaurantId}`,
            }, (payload) => {
                // Ignorar si ya hay una carga en curso
                if (HistState.cargando) return;

                const esNueva = payload.eventType === 'INSERT';
                Hist.cargar().then(() => {
                    if (esNueva) Toast.ok('Nuevo pedido registrado');
                });
            })
            .subscribe();
    },
};

function _histSetLoader(activo) {
    const lista = document.getElementById('hist-lista');
    if (activo && lista) {
        lista.innerHTML = `<div class="hist-loader"><div class="spinner-sm"></div><p>Cargando pedidos…</p></div>`;
    }
}

function _histSetError(msg) {
    const lista = document.getElementById('hist-lista');
    if (lista) lista.innerHTML = `
        <div class="empty-state" style="padding:56px 28px;">
            <div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
            <p>${msg}</p>
            <button onclick="Hist.recargar()"
                style="margin-top:12px;padding:11px 24px;border-radius:9999px;
                       background:var(--oliva);color:#fff;border:none;
                       font-family:'DM Sans',sans-serif;font-size:13px;
                       font-weight:500;cursor:pointer;">
                Reintentar
            </button>
        </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _crearTarjetaPedido(pedido, idx) {
    const { tipo, destino, cliente, direccion, nota } = _parsearNota(pedido.notes);

    const tipoIcons  = {
        mesa:      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>',
        llevar:    '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><polygon points="9 17 14 12 17 15 22 10 22 17 9 17"/></svg>',
        domicilio: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    };
    const tipoLabels = { mesa:'Mesa', llevar:'Para Llevar', domicilio:'Domicilio' };
    const statusLabels = {
        pending:'Pendiente', preparing:'En cocina',
        ready:'Listo', delivered:'Entregado', cancelled:'Cancelado',
    };

    const statusClass = pedido.status || 'pending';
    const nombreMostrar = pedido.customer_name || cliente || '';
    const editable = ESTADOS_EDITABLES.includes(pedido.status);

    const items = pedido.order_items || [];
    const itemsHTML = items.length > 0
        ? items.map(it => {
            let nombre = it.menu_items?.name || '';
            if (!nombre && it.notes) {
                const m = it.notes.match(/\[nombre\](.+)/);
                nombre = m ? m[1] : 'Ítem';
            }
            if (!nombre) nombre = 'Ítem';
            const precio = Number(it.unit_price) || 0;
            return `<div class="item-row">
                <div class="item-qty">${it.quantity}</div>
                <span class="item-name">${nombre}</span>
                <span class="item-price">${precio > 0 ? formatCOP(precio * it.quantity) : '—'}</span>
            </div>`;
        }).join('')
        : `<p style="font-size:12.5px;color:var(--ink-ghost);padding:4px 0;">Sin detalle de ítems.</p>`;

    const direccionHTML = (tipo === 'domicilio' && direccion)
        ? `<div class="card-direccion">
               <span style="display:inline-flex;align-items:center;flex-shrink:0;margin-top:1px;"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>
               <span class="card-direccion-text">${direccion}</span>
           </div>` : '';

    const notaHTML = nota
        ? `<div class="card-nota">
               <span style="display:inline-flex;align-items:center;flex-shrink:0;margin-top:1px;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>
               <span class="card-nota-text">${nota}</span>
           </div>` : '';

    const editarBtnHTML = editable
        ? `<button class="btn-editar-pedido" onclick="EditarPedido.abrir('${pedido.id}')" title="Editar este pedido">
               <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Editar pedido
           </button>`
        : '';

    const bodyId = `hbody-${pedido.id}`;
    const chevId = `hchev-${pedido.id}`;

    const card = document.createElement('div');
    card.className = 'order-card';
    card.style.animationDelay = `${idx * 0.04}s`;

    card.innerHTML = `
        <div class="card-head" onclick="toggleHistCard('${bodyId}','${chevId}')">
            <div class="card-head-left">
                <div class="card-tipo">
                    <span style="display:inline-flex;align-items:center;">${tipoIcons[tipo]||'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>'}</span>
                    <span class="tipo-text ${tipo}">${tipoLabels[tipo]||tipo}</span>
                </div>
                <p class="card-destino">${destino}</p>
                ${nombreMostrar ? `<p class="card-cliente"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${nombreMostrar}</p>` : ''}
                <p class="card-hora"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${_horaCorta(pedido.created_at)}</p>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                <span class="status-badge ${statusClass}">${statusLabels[statusClass]||statusClass}</span>
                <span class="card-chevron" id="${chevId}">▼</span>
            </div>
        </div>
        <div class="card-body" id="${bodyId}">
            ${direccionHTML}
            ${notaHTML}
            <div>${itemsHTML}</div>
            <div class="card-total-row">
                <span class="card-total-label">Total</span>
                <span class="card-total-monto">${formatCOP(pedido.total_amount)}</span>
            </div>
            <p class="card-order-no"># ${pedido.order_number || '—'}</p>
            ${editarBtnHTML}
        </div>`;

    return card;
}

function toggleHistCard(bodyId, chevId) {
    const body = document.getElementById(bodyId);
    const chev = document.getElementById(chevId);
    if (!body) return;
    const abierto = body.classList.toggle('open');
    if (chev) chev.classList.toggle('open', abierto);
}

// ============================================================
// ═══ MÓDULO EDITAR PEDIDO (v7.4) ═══
// ============================================================

const EditarPedido = {
    _pedidoId:    null,
    _pedido:      null,
    _itemsEdit:   [],
    _notaEdit:    '',
    _guardando:   false,

    async abrir(pedidoId) {
        this._pedidoId  = pedidoId;
        this._guardando = false;

        const modal = document.getElementById('edit-modal');
        if (!modal) return;
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        _editSetLoader(true);

        try {
            const { data: pedido, error } = await db
                .from('orders')
                .select(`
                    id, order_number, status, notes, total_amount,
                    order_items (
                        id, quantity, unit_price, notes, item_status,
                        menu_item_id,
                        menu_items ( name )
                    )
                `)
                .eq('id', pedidoId)
                .single();

            if (error) throw error;
            if (!pedido) throw new Error('Pedido no encontrado.');

            if (!ESTADOS_EDITABLES.includes(pedido.status)) {
                _editSetError(`Este pedido no se puede editar (estado: ${pedido.status}).`);
                return;
            }

            this._pedido = pedido;

            const parsed = _parsearNota(pedido.notes);
            this._notaEdit = parsed.nota;

            this._itemsEdit = (pedido.order_items || []).map(it => {
                let nombre = it.menu_items?.name || '';
                if (!nombre && it.notes) {
                    const m = it.notes.match(/\[nombre\](.+)/);
                    nombre = m ? m[1] : 'Ítem';
                }
                return {
                    id:          it.id,
                    menuItemId:  it.menu_item_id,
                    nombre:      nombre || 'Ítem',
                    precio:      Number(it.unit_price) || 0,
                    cantidad:    it.quantity,
                    item_status: it.item_status || 'pending',
                    esNuevo:     false,
                    eliminado:   false,
                };
            });

            this._renderEditor();

        } catch (err) {
            console.error('[EditarPedido] Error al abrir:', err);
            _editSetError(`No se pudo cargar el pedido: ${err.message}`);
        }
    },

    cerrar() {
        const modal = document.getElementById('edit-modal');
        if (modal) modal.classList.remove('open');
        document.body.style.overflow = '';
        this._pedidoId  = null;
        this._pedido    = null;
        this._itemsEdit = [];
        this._notaEdit  = '';
        this._guardando = false;
    },

    _renderEditor() {
        const contenedor = document.getElementById('edit-modal-body');
        if (!contenedor) return;

        const parsed  = _parsearNota(this._pedido.notes);
        const statusLabels = {
            pending:'Pendiente', preparing:'En cocina',
            ready:'Listo', delivered:'Entregado', cancelled:'Cancelado', confirmed:'Confirmado',
        };

        const tituloHTML = `
            <div class="edit-pedido-titulo">
                <span class="edit-order-no"># ${this._pedido.order_number || '—'}</span>
                <span class="status-badge ${this._pedido.status}">${statusLabels[this._pedido.status] || this._pedido.status}</span>
            </div>
            <p class="edit-destino-label">${parsed.destino}${parsed.cliente ? ` · ${parsed.cliente}` : ''}</p>`;

        const itemsHTML = this._itemsEdit
            .filter(it => !it.eliminado)
            .map((it, i) => this._renderItemRow(it, i))
            .join('');

        const slotsDisponibles = State.slots.filter(s => s.disponible);
        const opcionesSlots = slotsDisponibles.map(s =>
            `<option value="${s.id}">${s.nombre}${s.precio > 0 ? ' — ' + formatCOP(s.precio) : ' (Incluido)'}</option>`
        ).join('');

        contenedor.innerHTML = `
            ${tituloHTML}

            <div class="edit-section">
                <p class="edit-section-title">Ítems del pedido</p>
                <div id="edit-items-list">
                    ${itemsHTML || '<p class="edit-empty-items">Sin ítems.</p>'}
                </div>
            </div>

            <div class="edit-section">
                <p class="edit-section-title">Agregar ítem</p>
                <div class="edit-agregar-row">
                    <select id="edit-slot-select" class="form-input edit-select">
                        <option value="">— Selecciona un plato o bebida —</option>
                        ${opcionesSlots}
                    </select>
                    <div class="edit-qty-row">
                        <button class="edit-qty-btn" onclick="EditarPedido._decrementarNuevo()">−</button>
                        <span id="edit-nueva-qty" class="edit-qty-num">1</span>
                        <button class="edit-qty-btn" onclick="EditarPedido._incrementarNuevo()">+</button>
                        <button class="btn-agregar-item" onclick="EditarPedido._agregarItem()">Agregar</button>
                    </div>
                </div>
            </div>

            <div class="edit-section">
                <p class="edit-section-title">Nota del pedido</p>
                <textarea id="edit-nota-input" class="form-input" rows="2"
                    placeholder="Sin picante, sin cebolla, alergia a…">${this._notaEdit}</textarea>
            </div>

            <div class="edit-total-preview">
                <span class="edit-total-label">Total estimado</span>
                <span id="edit-total-monto" class="edit-total-monto">${formatCOP(this._calcularTotalEdit())}</span>
            </div>`;

        this._nuevaQty = 1;
        _editSetLoader(false);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _renderItemRow(it, i) {
        const noEliminable = ITEM_ESTADOS_NO_ELIMINABLES.includes(it.item_status) && !it.esNuevo;
        const precioStr    = it.precio > 0 ? formatCOP(it.precio) : 'Incl.';
        const subtotalStr  = it.precio > 0 ? formatCOP(it.precio * it.cantidad) : '—';

        return `
            <div class="edit-item-row" id="edit-item-row-${it.id || 'new-'+i}">
                <div class="edit-item-info">
                    <span class="edit-item-nombre">${it.nombre}</span>
                    <span class="edit-item-precio">${precioStr} c/u</span>
                </div>
                <div class="edit-item-ctrl">
                    <button class="edit-qty-btn" onclick="EditarPedido._cambiarCantidad('${it.id || 'new-'+i}', -1)"
                        ${it.cantidad <= 1 && noEliminable ? 'disabled title="No se puede reducir: ítem en cocina"' : ''}>−</button>
                    <span class="edit-qty-num">${it.cantidad}</span>
                    <button class="edit-qty-btn" onclick="EditarPedido._cambiarCantidad('${it.id || 'new-'+i}', +1)">+</button>
                    <span class="edit-item-subtotal">${subtotalStr}</span>
                    ${noEliminable
                        ? `<span class="edit-item-lock" title="En cocina, no se puede eliminar"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>`
                        : `<button class="edit-item-del" onclick="EditarPedido._eliminarItem('${it.id || 'new-'+i}')" title="Eliminar">✕</button>`
                    }
                </div>
            </div>`;
    },

    _nuevaQty: 1,

    _decrementarNuevo() {
        if (this._nuevaQty > 1) {
            this._nuevaQty--;
            const el = document.getElementById('edit-nueva-qty');
            if (el) el.textContent = this._nuevaQty;
        }
    },

    _incrementarNuevo() {
        this._nuevaQty++;
        const el = document.getElementById('edit-nueva-qty');
        if (el) el.textContent = this._nuevaQty;
    },

    _agregarItem() {
        const select = document.getElementById('edit-slot-select');
        const slotId = select?.value;
        if (!slotId) { Toast.error('Selecciona un plato o bebida.'); return; }

        const slot = State.slots.find(s => s.id === slotId);
        if (!slot) return;

        const existente = this._itemsEdit.find(it => !it.eliminado && it.menuItemId === slot.menuItemId && it.esNuevo);
        if (existente) {
            existente.cantidad += this._nuevaQty;
        } else {
            this._itemsEdit.push({
                id:          `new-${Date.now()}`,
                menuItemId:  slot.menuItemId,
                nombre:      slot.nombre,
                precio:      slot.precio,
                cantidad:    this._nuevaQty,
                item_status: 'pending',
                esNuevo:     true,
                eliminado:   false,
            });
        }

        if (select) select.value = '';
        this._nuevaQty = 1;
        const qtyEl = document.getElementById('edit-nueva-qty');
        if (qtyEl) qtyEl.textContent = '1';

        this._refrescarListaItems();
        this._actualizarTotalPreview();
        Toast.ok(`"${slot.nombre}" agregado al pedido.`);
    },

    _cambiarCantidad(itemId, delta) {
        const it = this._itemsEdit.find(i => i.id === itemId);
        if (!it || it.eliminado) return;

        const noEliminable = ITEM_ESTADOS_NO_ELIMINABLES.includes(it.item_status) && !it.esNuevo;
        const nueva = it.cantidad + delta;

        if (nueva <= 0) {
            if (noEliminable) {
                Toast.error(`No se puede eliminar "${it.nombre}": ya está en cocina.`);
                return;
            }
            it.eliminado = true;
        } else {
            it.cantidad = nueva;
        }

        this._refrescarListaItems();
        this._actualizarTotalPreview();
    },

    _eliminarItem(itemId) {
        const it = this._itemsEdit.find(i => i.id === itemId);
        if (!it) return;

        const noEliminable = ITEM_ESTADOS_NO_ELIMINABLES.includes(it.item_status) && !it.esNuevo;
        if (noEliminable) {
            Toast.error(`No se puede eliminar "${it.nombre}": ya está en cocina.`);
            return;
        }

        it.eliminado = true;
        this._refrescarListaItems();
        this._actualizarTotalPreview();
    },

    _refrescarListaItems() {
        const lista = document.getElementById('edit-items-list');
        if (!lista) return;
        const activos = this._itemsEdit.filter(it => !it.eliminado);
        if (activos.length === 0) {
            lista.innerHTML = '<p class="edit-empty-items">Sin ítems.</p>';
            return;
        }
        lista.innerHTML = activos.map((it, i) => this._renderItemRow(it, i)).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _calcularTotalEdit() {
        return this._itemsEdit
            .filter(it => !it.eliminado)
            .reduce((acc, it) => acc + it.precio * it.cantidad, 0);
    },

    _actualizarTotalPreview() {
        const el = document.getElementById('edit-total-monto');
        if (el) el.textContent = formatCOP(this._calcularTotalEdit());
    },

    async guardar() {
        if (this._guardando) return;
        if (!this._pedidoId || !this._pedido) return;

        const btnGuardar = document.getElementById('edit-btn-guardar');
        this._guardando = true;
        if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…'; }

        try {
            const notaInput = document.getElementById('edit-nota-input');
            const nuevaNota = (notaInput?.value || '').trim();

            const parsed = _parsearNota(this._pedido.notes);
            let notaBase = this._pedido.notes || '';
            notaBase = notaBase.replace(/\s*\|\s*Nota:\s*.+$/, '');
            if (nuevaNota) notaBase += ` | Nota: ${nuevaNota}`;
            const notaFinal = notaBase.trim();

            if (window.La26Core) {
                const resultado = await La26Core.guardarEdicionAdmin(
                    this._pedidoId,
                    this._itemsEdit,
                    notaFinal,
                    State.restaurantId
                );
                if (!resultado.ok) {
                    Toast.error(resultado.error || 'No se pudo guardar.');
                    return;
                }
            } else {
                await this._guardarLegacy(notaFinal);
            }

            Toast.ok('Pedido actualizado correctamente.');
            this.cerrar();
            await Hist.cargar();

        } catch (err) {
            console.error('[EditarPedido] Error al guardar:', err);
            Toast.error('No se pudo guardar. Verifica tu conexión.', 5000);
        } finally {
            this._guardando = false;
            const btn = document.getElementById('edit-btn-guardar');
            if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
        }
    },

    async _guardarLegacy(notaFinal) {
        const pedidoId        = this._pedidoId;
        const pedido          = this._pedido;
        const itemsOriginales = pedido.order_items || [];
        const idsOriginales   = new Set(itemsOriginales.map(i => i.id));

        const aEliminar  = this._itemsEdit.filter(it => it.eliminado && !it.esNuevo && idsOriginales.has(it.id));
        const aActualizar = this._itemsEdit.filter(it => !it.eliminado && !it.esNuevo && idsOriginales.has(it.id));
        const aNuevos    = this._itemsEdit.filter(it => it.esNuevo && !it.eliminado);

        for (const it of aEliminar) {
            const { error } = await db.from('order_items').delete().eq('id', it.id);
            if (error) console.warn('[EditarPedido] Error eliminando ítem:', error.message);
        }

        for (const it of aActualizar) {
            const original = itemsOriginales.find(o => o.id === it.id);
            if (original && original.quantity !== it.cantidad) {
                const { error } = await db.from('order_items')
                    .update({ quantity: it.cantidad })
                    .eq('id', it.id);
                if (error) console.warn('[EditarPedido] Error actualizando cantidad:', error.message);
            }
        }

        if (aNuevos.length > 0) {
            const { data: todosMenuItems } = await db.from('menu_items')
                .select('id,name').eq('restaurant_id', State.restaurantId).eq('is_active', true);
            const listaMenu = todosMenuItems || [];

            const payloadNuevos = aNuevos.map(it => {
                let menuItemId = it.menuItemId;
                if (!menuItemId && listaMenu.length > 0) {
                    const nb = (it.nombre || '').toLowerCase().trim();
                    const ex = listaMenu.find(m => m.name.toLowerCase().trim() === nb);
                    menuItemId = ex?.id || listaMenu[0]?.id || null;
                }
                return {
                    order_id:     pedidoId,
                    menu_item_id: menuItemId,
                    quantity:     it.cantidad,
                    unit_price:   it.precio,
                    item_status:  'pending',
                    product_name: it.nombre,
                    notes:        `[nombre]${it.nombre}`,
                };
            });

            const { error: errNuevos } = await db.from('order_items').insert(payloadNuevos);
            if (errNuevos) {
                if (errNuevos.code === '42703' || errNuevos.message?.includes('product_name')) {
                    const p2 = payloadNuevos.map(({ product_name, ...rest }) => rest);
                    const { error: err2 } = await db.from('order_items').insert(p2);
                    if (err2) console.warn('[EditarPedido] Error insertando nuevos ítems:', err2.message);
                } else {
                    console.warn('[EditarPedido] Error insertando nuevos ítems:', errNuevos.message);
                }
            }
        }

        const nuevoTotal = this._calcularTotalEdit();
        const { error: errUpdate } = await db.from('orders')
            .update({
                total_amount: nuevoTotal,
                notes:        notaFinal,
                updated_at:   new Date().toISOString(),
            })
            .eq('id', pedidoId);
        if (errUpdate) console.warn('[EditarPedido] Error actualizando orden:', errUpdate.message);
    },
};

function _editSetLoader(activo) {
    const body   = document.getElementById('edit-modal-body');
    const footer = document.getElementById('edit-modal-footer');
    if (activo) {
        if (body) body.innerHTML = `
            <div class="hist-loader" style="padding:60px 0;">
                <div class="spinner-sm"></div>
                <p>Cargando pedido…</p>
            </div>`;
        if (footer) footer.style.display = 'none';
    } else {
        if (footer) footer.style.display = 'flex';
    }
}

function _editSetError(msg) {
    const body   = document.getElementById('edit-modal-body');
    const footer = document.getElementById('edit-modal-footer');
    if (body) body.innerHTML = `
        <div class="empty-state" style="padding:56px 28px;">
            <div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
            <p>${msg}</p>
        </div>`;
    if (footer) footer.style.display = 'none';
}

// ============================================================
// VERIFICAR SI EL SISTEMA ESTÁ HABILITADO
// ============================================================
async function _verificarSistemaHabilitado() {
    try {
        const { data, error } = await db
            .from('system_settings')
            .select('value')
            .eq('key', 'orders_enabled')
            .maybeSingle();

        if (error || !data) return true;

        const habilitado = data.value === 'true';
        if (!habilitado) _mostrarPantallaFueraDeServicio();
        return habilitado;
    } catch (_) {
        return true;
    }
}

function _mostrarPantallaFueraDeServicio() {
    const carta     = document.getElementById('vista-carta');
    const historial = document.getElementById('vista-historial');
    const cartBar   = document.getElementById('cart-bar');
    const catsBar   = document.getElementById('cats-bar');
    if (carta)     carta.style.display     = 'none';
    if (historial) historial.style.display = 'none';
    if (cartBar)   cartBar.style.display   = 'none';
    if (catsBar)   catsBar.style.display   = 'none';

    const loader = document.getElementById('app-loader');
    if (loader) {
        loader.style.display = 'flex';
        loader.innerHTML = `
            <div style="text-align:center;padding:40px 20px;max-width:300px;">
                <div style="font-size:48px;margin-bottom:20px;display:flex;justify-content:center;align-items:center;"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
                <h2 style="font-family:'Cormorant Garamond',serif;font-size:1.8rem;
                           font-weight:400;color:var(--ink);margin-bottom:12px;line-height:1.2;">
                    Sistema fuera<br>de servicio
                </h2>
                <p style="font-size:13px;color:var(--ink-muted);line-height:1.65;">
                    El restaurante no está recibiendo pedidos en este momento.<br>
                    Consulta con el administrador.
                </p>
            </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}
// ============================================================
(async function init() {
    try {
        _programarResetMedianoche();
        await Sesion.requerir();

        // ── Verificar si el sistema está habilitado ──
        const _sistemaHabilitado = await _verificarSistemaHabilitado();
        if (!_sistemaHabilitado) return;

        await _resolverRestaurant();
        await Menu.cargar();

        // La26Core como canal adicional de realtime si está disponible
        if (window.La26Core && State.restaurantId) {
            La26Core.suscribirRealtime(State.restaurantId);

            La26Core.on('onMenuItemChange', ({ payload }) => {
                const item = payload?.new;
                if (!item?.id) return;
                _actualizarSlotDesdeRealtime(item);
            });

            La26Core.on('onOrderChange', () => {
                if (HistState.cargado) {
                    setTimeout(() => Hist.cargar(), 600);
                }
            });
        }

    } catch (err) {
        console.error('[La 26] Error crítico en init:', err);
        _mostrarEstado('error', `Error al iniciar la carta: ${err.message}`);
    }
})();

// Inicializar iconos Lucide en DOMContentLoaded (para elementos estáticos del HTML)
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
});

// ============================================================
// RESTAURANTE LA 26 — LÓGICA DE CARTA DIGITAL
// menu.js · Versión 4.1
// Bucaramanga, Santander — Colombia
//
// ACCESO PÚBLICO — SIN LOGIN, SIN CONTRASEÑA
// ─────────────────────────────────────────────────────────
//  menu.html + menu.js son 100% públicos para el cliente.
//  index.html es EXCLUSIVAMENTE la pantalla interna de cocina.
//  admin.html es EXCLUSIVAMENTE el panel del administrador.
//
//  Si no hay mesa_id en URL ni sessionStorage, se muestra
//  el modal de bienvenida (MesaModal) dentro de menu.html.
//  NUNCA se redirige a index.html ni se pide contraseña.
// ============================================================

// ── GUARD DE ACCESO PÚBLICO ──────────────────────────────
// Elimina cualquier dato de sesión de cocina/admin que pudiera
// haber quedado de una visita anterior, evitando colisiones.
// El cliente del menú NUNCA necesita user_role ni auth_token.
(function limpiarSesionInterna() {
    const clavesInternas = ['user_role', 'auth_token', 'admin_session', 'cocina_session', 'staff_token'];
    clavesInternas.forEach(function(k) { sessionStorage.removeItem(k); });
})();

// ============================================================
// TOAST NOTIFICATIONS — reemplaza todos los alert() nativos
// Estética "La 26": crema, Verde Oliva para éxito, arcilla para error
// ============================================================
const Toast = (function() {
    let container = null;

    function _ensureContainer() {
        if (container) return;
        container = document.createElement('div');
        container.id = 'toast-container';
        Object.assign(container.style, {
            position:      'fixed',
            top:           '20px',
            left:          '50%',
            transform:     'translateX(-50%)',
            zIndex:        '9999',
            display:       'flex',
            flexDirection: 'column',
            gap:           '8px',
            alignItems:    'center',
            pointerEvents: 'none',
            width:         'max-content',
            maxWidth:      'calc(100vw - 32px)',
        });
        document.body.appendChild(container);
    }

    function show(msg, tipo = 'info', duracion = 3800) {
        _ensureContainer();

        const colores = {
            ok:    { bg: '#f5f7f0', border: 'rgba(74,103,65,0.35)', text: '#2e4028', dot: '#4a6741' },
            error: { bg: '#fdf5f3', border: 'rgba(192,80,60,0.30)', text: '#6b2a1e', dot: '#c0503c' },
            info:  { bg: '#f5f7f0', border: 'rgba(74,103,65,0.25)', text: '#3a4a38', dot: '#4a6741' },
        };
        const c = colores[tipo] || colores.info;

        const toast = document.createElement('div');
        Object.assign(toast.style, {
            display:       'flex',
            alignItems:    'center',
            gap:           '9px',
            background:    c.bg,
            border:        `1.5px solid ${c.border}`,
            borderRadius:  '999px',
            padding:       '10px 20px 10px 14px',
            boxShadow:     '0 4px 20px rgba(0,0,0,0.10)',
            fontSize:      '13.5px',
            fontFamily:    "'DM Sans', sans-serif",
            fontWeight:    '500',
            color:         c.text,
            pointerEvents: 'auto',
            opacity:       '0',
            transform:     'translateY(-8px)',
            transition:    'opacity .28s ease, transform .28s ease',
            whiteSpace:    'pre-wrap',
            maxWidth:      'calc(100vw - 32px)',
        });

        const dot = document.createElement('span');
        Object.assign(dot.style, {
            width: '7px', height: '7px',
            borderRadius: '50%',
            background: c.dot,
            flexShrink: '0',
            display: 'block',
        });

        const txt = document.createElement('span');
        txt.textContent = msg;

        toast.appendChild(dot);
        toast.appendChild(txt);
        container.appendChild(toast);

        // Entrada
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.opacity   = '1';
                toast.style.transform = 'translateY(0)';
            });
        });

        // Salida
        const timer = setTimeout(() => {
            toast.style.opacity   = '0';
            toast.style.transform = 'translateY(-8px)';
            setTimeout(() => toast.remove(), 300);
        }, duracion);

        toast.onclick = () => { clearTimeout(timer); toast.remove(); };
    }

    return {
        ok:    (msg, ms) => show(msg, 'ok',    ms),
        error: (msg, ms) => show(msg, 'error', ms),
        info:  (msg, ms) => show(msg, 'info',  ms),
    };
})();


// ============================================================
// CREDENCIALES SUPABASE
// ============================================================
const SUPABASE_URL      = "https://hxmodeduckuhvvspnkxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ESxhljLgqWkGvrnKhvbeEg_iBqaGciv";

const _supabase      = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = _supabase;

// ============================================================
// SLUG CANÓNICO — usado para resolver el restaurant_id
// ============================================================
const RESTAURANT_SLUG = "restaurante-la-26";

// ============================================================
// CATEGORÍAS REALES DE LA COCINA
// Tipos válidos: protein | side | drink | a_la_carte
// El tipo 'sauce' NO existe como componente independiente.
// Las salsas siempre van integradas en la proteína.
// ============================================================
const CATEGORIAS = {
    protein:    { label: 'Proteína con Salsa', icono: '🥩', orden: 1 },
    side:       { label: 'Principio',          icono: '🍲', orden: 2 },
    drink:      { label: 'Bebida',             icono: '🥤', orden: 3 },
    a_la_carte: { label: 'A la Carta',         icono: '✨', orden: 4 },
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
let restaurantId    = null;
let tableId         = null;
let tableNumber     = null;
let tableNombre     = null;   // Nombre del cliente capturado via QR / sessionStorage
let modalidad       = null;   // 'mesa' | 'para_llevar' | 'domicilio' (sessionStorage)
let tipoEntrega     = 'retiro'; // 'retiro' | 'domicilio' — selección del cliente en el form
let dailyMenuId     = null;
let slots           = [];     // platos disponibles cargados de Supabase
let cart            = [];     // [{ slotId, cantidad }]
let isSubmitting    = false;
let filtroActual    = 'todos';

// ============================================================
// REFERENCIAS AL DOM
// ============================================================
const elLoader              = document.getElementById('app-loader');
const elError               = document.getElementById('app-error');
const elErrorMsg            = document.getElementById('error-message');
const elMenu                = document.getElementById('app-menu');
const elMenuSections        = document.getElementById('menu-sections');
const elBadgeMesa           = document.getElementById('badge-mesa');
const elConnDot             = document.getElementById('conn-dot');
const elWelcomeBanner       = document.getElementById('welcome-banner');
const elWelcomeText         = document.getElementById('welcome-text');
const elCartBar             = document.getElementById('cart-bar');
const elCartCount           = document.getElementById('cart-count');
const elCartTotal           = document.getElementById('cart-total');
const elOrderModal          = document.getElementById('order-modal');
const elOrderForm           = document.getElementById('order-form');
const elSummaryItems        = document.getElementById('summary-items');
const elSummaryTotal        = document.getElementById('summary-total');
const elSuccessModal        = document.getElementById('success-modal');
const elSuccessOrder        = document.getElementById('success-order-no');
const elCustomerName        = document.getElementById('customer-name');
const elNombreWrapper       = document.getElementById('nombre-field-wrapper');
const elCatsBar             = document.getElementById('cats-bar');
const elDeliveryWrapper     = document.getElementById('delivery-fields-wrapper');
const elDireccionWrapper    = document.getElementById('direccion-wrapper');
const elDeliveryAddress     = document.getElementById('delivery-address');
const elBtnRetiro           = document.getElementById('btn-retiro');
const elBtnDomicilio        = document.getElementById('btn-domicilio');

// ============================================================
// HELPERS
// ============================================================
function formatCOP(valor) {
    return '$' + Math.round(valor).toLocaleString('es-CO');
}

function todayISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function generarNumeroOrden() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `ORD-LA26-${year}-${rand}`;
}

function calcularTotal() {
    return cart.reduce((acc, item) => {
        const slot = slots.find(s => s.id === item.slotId);
        return acc + (slot ? slot.precio * item.cantidad : 0);
    }, 0);
}

function calcularCantidadTotal() {
    return cart.reduce((acc, item) => acc + item.cantidad, 0);
}

function slotsFiltrados() {
    if (filtroActual === 'todos') return slots;
    return slots.filter(s => s.itemType === filtroActual);
}

// ============================================================
// CAPTURA Y PERSISTENCIA DE MESA / MODALIDAD
//
// ACCESO TOTALMENTE PÚBLICO — nunca pide contraseña ni redirige
// al login de cocina (index.html).
//
// Flujo:
//  1. Lee mesa/nombre/modalidad desde URL params (QR) o sessionStorage.
//  2. Si no hay datos de ubicación, muestra el modal de bienvenida
//     para que el cliente elija mesa o modalidad desde el propio menu.html.
//  3. Devuelve el contexto o null si se delegó al modal.
// ============================================================
function capturarContexto() {
    const params = new URLSearchParams(window.location.search);

    // 1. URL tiene prioridad absoluta (viene del QR de la mesa)
    const mesaUrl      = params.get('mesa');
    const nombreUrl    = params.get('nombre');
    const modalidadUrl = params.get('modalidad'); // 'para_llevar' | 'domicilio' | null

    // 2. Fallback desde sessionStorage (persiste entre recargas)
    const mesaSession      = sessionStorage.getItem('mesa_id');
    const nombreSession    = sessionStorage.getItem('mesa_nombre');
    const modalidadSession = sessionStorage.getItem('mesa_modalidad');

    // Combinar — URL tiene prioridad
    const mesaFinal      = mesaUrl      || mesaSession      || null;
    const nombreFinal    = nombreUrl    || nombreSession    || '';
    const modalidadFinal = modalidadUrl || modalidadSession || 'mesa';

    // Sin mesa → mostrar el modal de bienvenida DENTRO de menu.html
    // NUNCA redirigir a index.html (esa es la pantalla de cocina/admin)
    if (!mesaFinal) {
        MesaModal.mostrar();
        return null;
    }

    // Persistir en sessionStorage para que sobreviva a recargas
    sessionStorage.setItem('mesa_id',        mesaFinal);
    sessionStorage.setItem('mesa_modalidad', modalidadFinal);
    if (nombreFinal) sessionStorage.setItem('mesa_nombre', nombreFinal);

    return {
        mesa:      mesaFinal,
        nombre:    nombreFinal,
        modalidad: modalidadFinal,
    };
}

// ============================================================
// MODAL DE BIENVENIDA — Selección de mesa o modalidad
//
// Se muestra cuando el cliente entra a menu.html directamente
// sin QR (sin mesa_id en URL ni sessionStorage).
// NO redirige a index.html. Todo ocurre dentro de menu.html.
// ============================================================
const MesaModal = {

    mostrar() {
        // Ocultar loader y error mientras el cliente elige su mesa
        if (elLoader) { elLoader.style.display = 'none'; }
        if (elError)  { elError.style.display  = 'none'; }
        if (elMenu)   { elMenu.style.display   = 'none'; }

        const modal = document.getElementById('mesa-welcome-modal');
        if (modal) {
            modal.style.display     = 'flex';
            modal.style.alignItems  = 'flex-end';
            modal.style.justifyContent = 'center';
            // Focus en el primer campo tras la animación de entrada
            setTimeout(() => {
                const inp = document.getElementById('wm-mesa-numero');
                if (inp) inp.focus();
            }, 300);
        }
    },

    ocultar() {
        const modal = document.getElementById('mesa-welcome-modal');
        if (modal) modal.style.display = 'none';
    },

    // Cambia entre pestaña "Mesa" y "Para llevar / Domicilio"
    cambiarTab(tab) {
        const tabMesa   = document.getElementById('wm-tab-mesa');
        const tabLlevar = document.getElementById('wm-tab-llevar');
        const panelMesa = document.getElementById('wm-panel-mesa');
        const panelLlevar = document.getElementById('wm-panel-llevar');
        if (!tabMesa || !tabLlevar || !panelMesa || !panelLlevar) return;

        if (tab === 'mesa') {
            tabMesa.classList.add('wm-tab-active');
            tabLlevar.classList.remove('wm-tab-active');
            panelMesa.style.display   = 'flex';
            panelLlevar.style.display = 'none';
        } else {
            tabLlevar.classList.add('wm-tab-active');
            tabMesa.classList.remove('wm-tab-active');
            panelLlevar.style.display = 'flex';
            panelMesa.style.display   = 'none';
        }
    },

    // Confirmar selección de mesa en el restaurante
    confirmarMesa() {
        const numEl   = document.getElementById('wm-mesa-numero');
        const nombreEl = document.getElementById('wm-nombre-mesa');
        const numVal  = numEl ? numEl.value.trim() : '';
        const nombre  = nombreEl ? nombreEl.value.trim() : '';

        if (!numVal) {
            if (numEl) { numEl.focus(); numEl.classList.add('wm-field-error'); }
            return;
        }
        if (numEl) numEl.classList.remove('wm-field-error');

        sessionStorage.setItem('mesa_id',        numVal);
        sessionStorage.setItem('mesa_modalidad', 'mesa');
        if (nombre) sessionStorage.setItem('mesa_nombre', nombre);

        this.ocultar();
        cargarMenu();
    },

    // Confirmar selección de para llevar / domicilio
    confirmarLlevar() {
        const nombreEl   = document.getElementById('wm-nombre-llevar');
        const tipoEl     = document.getElementById('wm-tipo-llevar'); // 'retiro' | 'domicilio'
        const direccEl   = document.getElementById('wm-direccion');
        const nombre     = nombreEl   ? nombreEl.value.trim()   : '';
        const tipoVal    = tipoEl     ? tipoEl.value            : 'retiro';
        const direccion  = direccEl   ? direccEl.value.trim()   : '';

        if (!nombre) {
            if (nombreEl) { nombreEl.focus(); nombreEl.classList.add('wm-field-error'); }
            return;
        }
        if (nombreEl) nombreEl.classList.remove('wm-field-error');

        if (tipoVal === 'domicilio' && !direccion) {
            if (direccEl) { direccEl.focus(); direccEl.classList.add('wm-field-error'); }
            return;
        }
        if (direccEl) direccEl.classList.remove('wm-field-error');

        // Persistir contexto de para llevar
        sessionStorage.setItem('mesa_id',        tipoVal === 'domicilio' ? 'domicilio' : 'para_llevar');
        sessionStorage.setItem('mesa_modalidad', tipoVal === 'domicilio' ? 'domicilio' : 'para_llevar');
        sessionStorage.setItem('mesa_nombre',    nombre);
        if (tipoVal === 'domicilio' && direccion) {
            sessionStorage.setItem('mesa_direccion', direccion);
        }

        this.ocultar();
        cargarMenu();
    },

    // Muestra/oculta el campo de dirección según el tipo elegido
    toggleDireccion() {
        const tipoEl   = document.getElementById('wm-tipo-llevar');
        const wrapEl   = document.getElementById('wm-direccion-wrap');
        if (!tipoEl || !wrapEl) return;
        wrapEl.style.display = tipoEl.value === 'domicilio' ? 'block' : 'none';
    },
};

// ============================================================
// CONTROL DE INTERFAZ
// ============================================================
function mostrarLoader() {
    elLoader.style.display = 'flex';
    elError.style.display  = 'none';
    elMenu.style.display   = 'none';
    setConexion('cargando');
}

function mostrarError(msg) {
    elLoader.style.display = 'none';
    elError.style.display  = 'flex';
    elMenu.style.display   = 'none';
    elErrorMsg.textContent = msg;
    setConexion('error');
}

function mostrarMenu() {
    elLoader.style.display = 'none';
    elError.style.display  = 'none';
    elMenu.style.display   = 'block';
    setConexion('ok');
}

function setConexion(estado) {
    const colores = {
        ok:       '#4a5a28',
        error:    '#b83232',
        cargando: '#d4a853',
    };
    elConnDot.style.background = colores[estado] || colores.cargando;
    if (estado === 'ok') {
        elConnDot.style.animation = 'none';
    } else {
        elConnDot.style.animation = 'pulse 2s ease-in-out infinite';
    }
}

// ── Muestra el badge de mesa y el banner de bienvenida ──────
function mostrarInfoMesa(numero, nombre) {
    // Badge compacto en el header
    if (elBadgeMesa) {
        elBadgeMesa.textContent   = numero;
        elBadgeMesa.style.display = 'inline-flex';
    }

    // Banner de bienvenida elegante
    if (elWelcomeBanner && elWelcomeText) {
        const textoNombre = nombre ? ` · Bienvenido, ${nombre}` : '';
        elWelcomeText.textContent = `${numero}${textoNombre}`;
        elWelcomeBanner.classList.add('visible');
    }

    // Si viene el nombre via QR/sessionStorage, pre-llenar el campo del modal
    if (nombre && elCustomerName) {
        elCustomerName.value = nombre;
        // Solo ocultamos el campo de nombre si no es para llevar/domicilio
        // (en esos casos, queremos que el cliente confirme su nombre)
        if (modalidad === 'mesa' && elNombreWrapper) {
            elNombreWrapper.style.display = 'none';
        }
    }

    // ── Configurar campos de Para Llevar / Domicilio ──────────
    configurarCamposModalidad();
}

// ── Muestra u oculta el bloque de campos de entrega según modalidad ──
function configurarCamposModalidad() {
    if (!elDeliveryWrapper) return;

    const esPararLlevar = (modalidad === 'para_llevar' || modalidad === 'domicilio');

    if (esPararLlevar) {
        // Mostrar campos de entrega
        elDeliveryWrapper.classList.remove('hidden-field');
        elDeliveryWrapper.style.display = 'flex';

        // Si la modalidad ya viene como "domicilio", pre-seleccionar ese botón
        if (modalidad === 'domicilio') {
            Order.seleccionarEntrega('domicilio');
        } else {
            Order.seleccionarEntrega('retiro');
        }

        // Aseguramos que el campo de nombre siempre sea visible para para llevar
        if (elNombreWrapper) {
            elNombreWrapper.style.display = 'block';
        }
    } else {
        // Mesa normal → ocultar campos de entrega
        elDeliveryWrapper.classList.add('hidden-field');
        elDeliveryWrapper.style.display = 'none';
    }
}

function actualizarCarritoBar() {
    const cantidad = calcularCantidadTotal();
    const total    = calcularTotal();

    elCartCount.textContent = cantidad;
    elCartTotal.textContent = formatCOP(total);

    if (cantidad > 0) {
        elCartBar.style.transform     = 'translateY(0)';
        elCartBar.style.opacity       = '1';
        elCartBar.style.pointerEvents = 'auto';
    } else {
        elCartBar.style.transform     = 'translateY(115%)';
        elCartBar.style.opacity       = '0';
        elCartBar.style.pointerEvents = 'none';
    }
}

// ============================================================
// BARRA DE CATEGORÍAS
// Solo muestra las categorías con al menos un plato disponible.
// Nunca genera botón para 'sauce'.
// ============================================================
function renderizarCatsBar() {
    if (!elCatsBar) return;
    elCatsBar.innerHTML = '';

    // Botón "Todos"
    const btnTodos       = document.createElement('button');
    btnTodos.className   = `cat-btn${filtroActual === 'todos' ? ' active' : ''}`;
    btnTodos.textContent = 'Todos';
    btnTodos.onclick     = () => cambiarFiltro('todos');
    elCatsBar.appendChild(btnTodos);

    // Un botón por cada categoría presente (excluye 'sauce' al filtrar con CATEGORIAS)
    const tiposPresentes = [...new Set(slots.map(s => s.itemType))].filter(t => CATEGORIAS[t]);
    tiposPresentes
        .sort((a, b) => (CATEGORIAS[a]?.orden || 99) - (CATEGORIAS[b]?.orden || 99))
        .forEach(tipo => {
            const cfg = CATEGORIAS[tipo];
            const btn = document.createElement('button');
            btn.className   = `cat-btn${filtroActual === tipo ? ' active' : ''}`;
            btn.textContent = `${cfg.icono} ${cfg.label}`;
            btn.onclick     = () => cambiarFiltro(tipo);
            elCatsBar.appendChild(btn);
        });
}

function cambiarFiltro(tipo) {
    filtroActual = tipo;
    renderizarCatsBar();
    renderizarMenu();
}

// ============================================================
// RENDERIZADO DEL MENÚ
// Agrupa los slots por CATEGORIAS (protein/side/drink/a_la_carte).
// Nunca muestra sección para el tipo 'sauce'.
// ============================================================
function renderizarMenu() {
    elMenuSections.innerHTML = '';

    const lista = slotsFiltrados();

    if (!lista || lista.length === 0) {
        elMenuSections.innerHTML = `
            <div class="empty-state">
                <div class="icon">🍽️</div>
                <p>No hay platos disponibles<br>en esta categoría por el momento.</p>
            </div>`;
        return;
    }

    // Agrupar por itemType
    const grupos = {};
    lista.forEach(slot => {
        const tipo = CATEGORIAS[slot.itemType] ? slot.itemType : 'a_la_carte';
        if (!grupos[tipo]) grupos[tipo] = [];
        grupos[tipo].push(slot);
    });

    // Renderizar en el orden definido en CATEGORIAS
    const tiposOrdenados = Object.keys(grupos).sort(
        (a, b) => (CATEGORIAS[a]?.orden || 99) - (CATEGORIAS[b]?.orden || 99)
    );

    tiposOrdenados.forEach((tipo, secIdx) => {
        const cfg    = CATEGORIAS[tipo];
        const platos = grupos[tipo];
        if (!platos || platos.length === 0) return;

        const seccion = document.createElement('div');

        // Encabezado de sección
        const header = document.createElement('div');
        header.className = 'section-label';
        header.innerHTML = `<h2>${cfg.icono} ${cfg.label}</h2>`;
        seccion.appendChild(header);

        // Tarjetas con delay de animación escalonado
        platos.forEach((slot, i) => {
            const tarjeta = crearTarjeta(slot);
            tarjeta.style.animationDelay = `${secIdx * 0.06 + i * 0.05}s`;
            seccion.appendChild(tarjeta);
        });

        elMenuSections.appendChild(seccion);
    });
}

// ============================================================
// CREAR TARJETA DE PLATO
// ============================================================
function crearTarjeta(slot) {
    const disponible        = slot.disponible && slot.porciones > 0;
    const pocasLeft         = disponible && slot.porciones > 0 && slot.porciones <= 5;
    const enCarrito         = cart.find(c => c.slotId === slot.id);
    const cantidadEnCarrito = enCarrito ? enCarrito.cantidad : 0;

    // Badge de disponibilidad
    let badgeHTML = '';
    if (!disponible) {
        badgeHTML = `<span class="badge-agotado">Agotado</span>`;
    } else if (pocasLeft) {
        badgeHTML = `<span class="badge-pocas">¡Solo quedan ${slot.porciones}!</span>`;
    }

    // Precio o "Incluido"
    const precioHTML = slot.precio > 0
        ? `<span class="plate-price">${formatCOP(slot.precio)}</span>`
        : `<span class="plate-price incluido">Incluido</span>`;

    // Control de cantidad
    let controlHTML = '';
    if (disponible) {
        if (cantidadEnCarrito === 0) {
            controlHTML = `
                <button
                    class="btn-add"
                    onclick="Cart.agregar('${slot.id}')"
                    aria-label="Agregar ${slot.nombre}">+</button>`;
        } else {
            controlHTML = `
                <div class="qty-chip">
                    <button onclick="Cart.cambiarCantidad('${slot.id}', -1)" aria-label="Quitar uno">−</button>
                    <span>${cantidadEnCarrito}</span>
                    <button onclick="Cart.cambiarCantidad('${slot.id}', +1)" aria-label="Agregar uno">+</button>
                </div>`;
        }
    }

    const tarjeta     = document.createElement('div');
    tarjeta.id        = `tarjeta-${slot.id}`;
    tarjeta.className = `plate-card${!disponible ? ' agotado' : ''}`;
    tarjeta.innerHTML = `
        <div class="plate-info">
            <p class="plate-name">${slot.nombre}</p>
            ${slot.descripcion ? `<p class="plate-desc">${slot.descripcion}</p>` : ''}
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;">
                ${precioHTML}
                ${badgeHTML}
            </div>
        </div>
        <div style="flex-shrink:0;">${controlHTML}</div>`;

    return tarjeta;
}

function refrescarTarjeta(slotId) {
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return;
    const vieja = document.getElementById(`tarjeta-${slotId}`);
    if (vieja) vieja.replaceWith(crearTarjeta(slot));
}

// ============================================================
// CARRITO
// ============================================================
const Cart = {

    agregar(slotId) {
        const slot = slots.find(s => s.id === slotId);
        if (!slot || !slot.disponible) return;

        const existente = cart.find(c => c.slotId === slotId);
        if (existente) {
            if (slot.porciones > 0 && existente.cantidad >= slot.porciones) {
                Toast.error(`Solo quedan ${slot.porciones} porciones de "${slot.nombre}".`);
                return;
            }
            existente.cantidad++;
        } else {
            cart.push({ slotId, cantidad: 1 });
        }

        refrescarTarjeta(slotId);
        actualizarCarritoBar();
    },

    cambiarCantidad(slotId, delta) {
        const slot = slots.find(s => s.id === slotId);
        if (!slot) return;

        const idx = cart.findIndex(c => c.slotId === slotId);
        if (idx === -1) return;

        const nueva = cart[idx].cantidad + delta;

        if (delta > 0 && slot.porciones > 0 && nueva > slot.porciones) {
            Toast.error(`Solo quedan ${slot.porciones} porciones de "${slot.nombre}".`);
            return;
        }

        if (nueva <= 0) {
            cart.splice(idx, 1);
        } else {
            cart[idx].cantidad = nueva;
        }

        refrescarTarjeta(slotId);
        actualizarCarritoBar();

        // Si el modal está abierto, actualizarlo en tiempo real
        if (elOrderModal.style.display !== 'none') {
            this.renderSummary();
        }
    },

    openSummary() {
        this.renderSummary();
        elOrderModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    },

    closeSummary() {
        elOrderModal.style.display   = 'none';
        document.body.style.overflow = '';
    },

    renderSummary() {
        elSummaryItems.innerHTML = '';

        if (cart.length === 0) {
            elSummaryItems.innerHTML = `
                <div style="text-align:center;padding:36px 0;">
                    <p style="font-size:13px;color:var(--ink-ghost);">Tu pedido está vacío.</p>
                </div>`;
            elSummaryTotal.textContent = '$0';
            return;
        }

        cart.forEach(item => {
            const slot = slots.find(s => s.id === item.slotId);
            if (!slot) return;

            const subtotal = slot.precio * item.cantidad;
            const fila     = document.createElement('div');
            fila.className = 'summary-row';
            fila.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <p class="summary-name">${slot.nombre}</p>
                    <p class="summary-qty">${item.cantidad} × ${slot.precio > 0 ? formatCOP(slot.precio) : 'Incluido'}</p>
                </div>
                <span class="summary-price">
                    ${slot.precio > 0 ? formatCOP(subtotal) : '—'}
                </span>`;
            elSummaryItems.appendChild(fila);
        });

        elSummaryTotal.textContent = formatCOP(calcularTotal());
    },
};

// ============================================================
// RESOLVER MENU_ITEM_IDs
// Resuelve el problema cuando los slots tienen menuItemId: null.
// 1. Trae todos los menu_items activos del restaurante.
// 2. Para cada ítem del carrito busca el ID real por nombre.
// 3. Excluye explícitamente cualquier item_type 'sauce'.
// ============================================================
async function resolverMenuItemIds() {
    const { data: itemsReales, error } = await supabaseClient
        .from('menu_items')
        .select('id, name, price, item_type')
        .eq('is_active', true)
        .eq('restaurant_id', restaurantId)
        // [FIX] Solo tipos validos del enum (protein/sauce NO existen)
        .in('item_type', ['executive_lunch', 'a_la_carte', 'drink', 'dessert', 'side']);

    if (error) {
        console.warn('[La 26] No se pudieron cargar menu_items:', error);
    }

    const lista      = itemsReales || [];
    const fallbackId = lista[0]?.id || null;
    const resultado  = [];

    for (const item of cart) {
        const slot = slots.find(s => s.id === item.slotId);
        if (!slot) continue;

        let menuItemId = slot.menuItemId;

        if (!menuItemId && lista.length > 0) {
            const nombreBuscar = (slot.nombre || '').toLowerCase().trim();

            // 1. Coincidencia exacta por nombre
            const exacto = lista.find(m =>
                m.name.toLowerCase().trim() === nombreBuscar
            );
            // 2. Coincidencia parcial (primera palabra)
            const parcial = !exacto && lista.find(m =>
                m.name.toLowerCase().includes(nombreBuscar.split(' ')[0]) ||
                nombreBuscar.includes(m.name.toLowerCase().split(' ')[0])
            );
            // 3. Mismo item_type como último criterio antes del fallback
            const mismoCat = !exacto && !parcial && lista.find(m =>
                m.item_type === slot.itemType
            );

            menuItemId = exacto?.id || parcial?.id || mismoCat?.id || fallbackId;

            if (exacto)       console.log(`[La 26] ✅ Match exacto para "${slot.nombre}"`);
            else if (parcial)  console.log(`[La 26] ⚡ Match parcial para "${slot.nombre}"`);
            else if (mismoCat) console.log(`[La 26] 🔁 Match por categoría para "${slot.nombre}"`);
            else if (fallbackId) console.log(`[La 26] ⚠️ Fallback para "${slot.nombre}"`);
        }

        if (!menuItemId) {
            console.warn(`[La 26] ⛔ Sin menu_item_id para "${slot.nombre}". Ítem omitido.`);
            continue;
        }

        resultado.push({
            menuItemId,
            // daily_menu_slot_id solo aplica cuando hay menu del dia activo y el slot es real
            // Si cargamos del catalogo directo (sin daily_menu), slot.id === menu_item_id,
            // NO debe pasarse como daily_menu_slot_id o el join falla en Supabase.
            slotId:   (item.slotId && item.slotId.startsWith("mock-") || !dailyMenuId) ? null : item.slotId,
            cantidad: item.cantidad,
            precio:   slot.precio,
            nombre:   slot.nombre,
        });
    }

    return resultado;
}

// ============================================================
// PEDIDOS — LÓGICA DE TIPO DE ENTREGA
// ============================================================
const Order = {

    // Cambia visualmente el selector de entrega (retiro vs domicilio)
    seleccionarEntrega(tipo) {
        tipoEntrega = tipo;

        if (elBtnRetiro) {
            elBtnRetiro.classList.toggle('selected', tipo === 'retiro');
        }
        if (elBtnDomicilio) {
            elBtnDomicilio.classList.toggle('selected', tipo === 'domicilio');
        }

        // Mostrar u ocultar campo de dirección
        if (elDireccionWrapper) {
            if (tipo === 'domicilio') {
                elDireccionWrapper.classList.remove('hidden-field');
                elDireccionWrapper.style.display = 'block';
                if (elDeliveryAddress) elDeliveryAddress.required = true;
            } else {
                elDireccionWrapper.classList.add('hidden-field');
                elDireccionWrapper.style.display = 'none';
                if (elDeliveryAddress) {
                    elDeliveryAddress.required = false;
                    elDeliveryAddress.value    = '';
                }
            }
        }
    },

    // ── Submit del pedido ─────────────────────────────────────
    async submit(event) {
        event.preventDefault();
        if (isSubmitting) return;

        // Nombre del cliente: viene del campo visible O del capturado via QR/sessionStorage
        const nombreCampo = elCustomerName ? elCustomerName.value.trim() : '';
        const nombreFinal = nombreCampo || tableNombre || '';

        if (!nombreFinal) {
            if (elCustomerName) elCustomerName.focus();
            Toast.error('Por favor ingresa tu nombre para que podamos avisarte cuando tu pedido esté listo.');
            return;
        }

        if (cart.length === 0) return;

        // Validar dirección si eligió domicilio
        const esPararLlevar = (modalidad === 'para_llevar' || modalidad === 'domicilio');
        let direccionEntrega = '';
        let tipoDespacho    = 'mesa'; // 'mesa' | 'retiro' | 'domicilio'

        if (esPararLlevar) {
            tipoDespacho = tipoEntrega; // 'retiro' | 'domicilio'
            if (tipoEntrega === 'domicilio') {
                direccionEntrega = elDeliveryAddress ? elDeliveryAddress.value.trim() : '';
                if (!direccionEntrega) {
                    if (elDeliveryAddress) elDeliveryAddress.focus();
                    Toast.error('Por favor ingresa la dirección de entrega para el domicilio.');
                    return;
                }
            }
        }

        // ── GUARD: orders.table_id es NOT NULL — nunca puede ser null ────────────
        // Si el cliente llegó por Para Llevar / Domicilio y tableId no se resolvió
        // durante la carga inicial (falla silenciosa del INSERT automático por
        // qr_code faltante), lo buscamos aquí antes de continuar.
        if (!tableId) {
            const { data: mesaVirtual } = await supabaseClient
                .from('tables')
                .select('id')
                .eq('restaurant_id', restaurantId)
                .ilike('label', '%para llevar%')
                .maybeSingle();

            if (mesaVirtual?.id) {
                tableId = mesaVirtual.id;
                console.log('[La 26] ✅ tableId resuelto en submit desde mesa virtual existente');
            } else {
                // Crear la mesa virtual como último recurso con todos los campos requeridos
                const { data: mesaNueva } = await supabaseClient
                    .from('tables')
                    .upsert([{
                        restaurant_id: restaurantId,
                        number:        0,
                        label:         'Para Llevar / Domicilio',
                        qr_code:       `VIRTUAL-TAKEAWAY-${restaurantId}`,
                        capacity:      99,
                        status:        'available',
                    }], { onConflict: 'restaurant_id,number' })
                    .select('id')
                    .single();

                tableId = mesaNueva?.id || null;

                if (!tableId) {
                    Toast.error('No se pudo identificar la mesa. Por favor recarga la página e intenta de nuevo.');
                    return;
                }
                console.log('[La 26] ✅ Mesa virtual "Para Llevar" creada automáticamente en submit.');
            }
        }

        isSubmitting = true;
        const btnSubmit = elOrderForm.querySelector('button[type="submit"]');
        if (btnSubmit) {
            btnSubmit.disabled    = true;
            btnSubmit.textContent = 'Enviando a cocina…';
        }

        const numeroOrden = generarNumeroOrden();
        const totalMonto  = calcularTotal();

        // Construir notas de despacho para la cocina
        // La dirección y modalidad van SIEMPRE en el campo notes (evita error 42703
        // por columnas delivery_type / delivery_address que pueden no existir aún)
        let notasCocina = '';
        if (tipoDespacho === 'retiro') {
            notasCocina = `[PARA LLEVAR] Cliente: ${nombreFinal} — Retira en el restaurante`;
        } else if (tipoDespacho === 'domicilio') {
            notasCocina = `[DOMICILIO] Cliente: ${nombreFinal} — Dirección: ${direccionEntrega}`;
        } else {
            notasCocina = tableNumber ? `[MESA] ${tableNumber}` : '';
        }

        try {
            // ── Paso 1: resolver IDs reales ──────────────────────
            const itemsResueltos = await resolverMenuItemIds();

            // ── Paso 2: insertar la orden maestra en 'orders' ────
            // IMPORTANTE: Solo se usan columnas que siempre existen en el esquema.
            // delivery_type y delivery_address NO se incluyen aquí porque generan
            // error 42703 si la migración no se ha ejecutado en Supabase.
            // Toda la info de modalidad/dirección queda guardada en 'notes'.
            const ordenPayload = {
                restaurant_id: restaurantId,
                table_id:      tableId,        // ← siempre tiene valor aquí gracias al guard
                order_number:  numeroOrden,
                status:        'pending',
                customer_name: nombreFinal,
                total_amount:  totalMonto,
                daily_menu_id: dailyMenuId  || null,
                notes:         notasCocina  || null,
            };

            const { data: orden, error: errorOrden } = await supabaseClient
                .from('orders')
                .insert([ordenPayload])
                .select('id')
                .single();

            if (errorOrden) throw errorOrden;

            // ── Paso 3: insertar order_items ─────────────────────
            if (itemsResueltos.length > 0) {
                const { error: errorItems } = await supabaseClient
                    .from('order_items')
                    .insert(itemsResueltos.map(item => ({
                        order_id:           orden.id,
                        menu_item_id:       item.menuItemId,
                        daily_menu_slot_id: item.slotId,
                        quantity:           item.cantidad,
                        unit_price:         item.precio,
                        item_status:        'pending',
                        // El nombre real del plato se guarda en notes con prefijo [nombre]
                        // para que la pantalla de cocina lo muestre aunque el join falle
                        notes:              `[nombre]${item.nombre}`,
                    })));

                if (errorItems) {
                    console.error('[La 26] ❌ Error en order_items:', errorItems);
                    // La orden maestra ya existe — no bloqueamos al cliente
                }
            }

            this.mostrarExito(numeroOrden);

        } catch (err) {
            console.error('[La 26] Error al insertar pedido:', err);
            // Mostrar detalle del error de Supabase si está disponible
            const detalle = err?.message || err?.details || '';
            Toast.error('No se pudo enviar el pedido. Por favor llama a un mesero o intenta de nuevo.' + (detalle ? `\n(${detalle})` : ''), 5000);
        } finally {
            isSubmitting = false;
            if (btnSubmit) {
                btnSubmit.disabled    = false;
                btnSubmit.textContent = 'Enviar pedido a cocina';
            }
        }
    },

    mostrarExito(numeroOrden) {
        Cart.closeSummary();
        elSuccessOrder.textContent       = numeroOrden;
        elSuccessModal.style.display     = 'flex';
        // Limpiar carrito local tras envío exitoso
        cart = [];
        actualizarCarritoBar();
    },

    newOrder() {
        // Si el nombre vino via QR y es pedido en mesa, no limpiamos el campo
        const limpiarNombre = !(tableNombre && modalidad === 'mesa');
        if (limpiarNombre && elCustomerName) {
            elCustomerName.value = '';
        }
        // Limpiar dirección de domicilio
        if (elDeliveryAddress) {
            elDeliveryAddress.value = '';
        }
        elSuccessModal.style.display = 'none';
        renderizarMenu();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },
};

// ============================================================
// RESOLVER RESTAURANT_ID
// ============================================================
async function resolverRestaurantId() {
    try {
        // Buscar por slug canónico
        const { data: porSlug } = await supabaseClient
            .from('restaurants')
            .select('id')
            .eq('slug', RESTAURANT_SLUG)
            .maybeSingle();

        if (porSlug?.id) return porSlug.id;

        // Fallback: cualquier restaurante en la tabla
        const { data: cualquiera } = await supabaseClient
            .from('restaurants')
            .select('id')
            .limit(1)
            .maybeSingle();

        if (cualquiera?.id) {
            console.warn('[La 26] Restaurante encontrado sin slug. Actualiza el slug a "restaurante-la-26".');
            return cualquiera.id;
        }

        // Tabla vacía → insertar automáticamente
        const { data: nuevo, error } = await supabaseClient
            .from('restaurants')
            .insert([{ name: 'Restaurante la 26', slug: RESTAURANT_SLUG }])
            .select('id')
            .single();

        if (error) throw error;
        console.log('[La 26] ✅ Restaurante creado automáticamente.');
        return nuevo.id;

    } catch (err) {
        console.error('[La 26] Error resolviendo restaurant_id:', err);
        return null;
    }
}

// ============================================================
// CARGAR SLOTS DESDE VISTA daily_menu_slots_availability
// ============================================================
async function cargarSlotsDesdeMenuDia() {
    const { data: rawSlots, error } = await supabaseClient
        .from('daily_menu_slots_availability')
        .select(`
            id,
            menu_item_id,
            item_name,
            price,
            category_name,
            category_order,
            display_order,
            portions_available,
            portions_sold,
            is_truly_available,
            item_type
        `)
        .eq('daily_menu_id', dailyMenuId)
        // [FIX] Solo tipos validos del enum (protein/sauce NO existen)
        .in('item_type', ['executive_lunch', 'a_la_carte', 'drink', 'dessert', 'side'])
        .order('category_order', { ascending: true })
        .order('display_order',  { ascending: true });

    if (error || !rawSlots || rawSlots.length === 0) {
        console.log('[La 26] Sin slots en daily_menu → cargando catálogo directo. Error:', error);
        await cargarSlotsDesdeCatalogo();
        return;
    }

    slots = rawSlots.map(s => ({
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

    renderizarCatsBar();
    renderizarMenu();
    mostrarMenu();
    suscribirTiempoReal();
}

// ============================================================
// CARGAR SLOTS DIRECTAMENTE DEL CATÁLOGO menu_items
// Excluye por completo el item_type 'sauce'.
// ============================================================
async function cargarSlotsDesdeCatalogo() {
    const { data: items, error } = await supabaseClient
        .from('menu_items')
        .select('id, name, price, item_type, is_active, description')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        // [FIX] Solo tipos validos del enum (protein/sauce NO existen)
        .in('item_type', ['executive_lunch', 'a_la_carte', 'drink', 'dessert', 'side'])
        .order('item_type', { ascending: true })
        .order('name',      { ascending: true });

    if (error) {
        console.error('[La 26] Error cargando catálogo:', error);
        activarModoDemo();
        return;
    }

    if (!items || items.length === 0) {
        console.log('[La 26] Catálogo vacío → modo Demo');
        activarModoDemo();
        return;
    }

    slots = items.map(item => ({
        id:          item.id,
        menuItemId:  item.id,
        nombre:      item.name,
        precio:      Number(item.price) || 0,
        descripcion: item.description || '',
        itemType:    CATEGORIAS[item.item_type] ? item.item_type : 'a_la_carte',
        porciones:   999,
        disponible:  true,
    }));

    renderizarCatsBar();
    renderizarMenu();
    mostrarMenu();
}

// ============================================================
// MODO DEMO — datos de ejemplo cuando Supabase no tiene nada.
// Refleja los tipos reales de la cocina de La 26.
// No contiene ningún ítem de tipo 'sauce'.
// ============================================================
function activarModoDemo() {
    console.log('[La 26] 🎭 Modo Demo activo');
    slots = [
        { id:'mock-p1', menuItemId:null, nombre:'Pechuga a la Plancha con Salsa Criolla',    precio:16000, descripcion:'Pechuga jugosa a la plancha bañada en salsa criolla de tomate y cebolla caramelizada.',         itemType:'protein',    porciones:12, disponible:true  },
        { id:'mock-p2', menuItemId:null, nombre:'Tilapia Frita con Salsa de Ajo',             precio:18000, descripcion:'Tilapia del día frita en aceite de maíz con salsa de ajo y limón.',                            itemType:'protein',    porciones:8,  disponible:true  },
        { id:'mock-p3', menuItemId:null, nombre:'Cerdo al Horno con Salsa BBQ',               precio:17000, descripcion:'Lomo de cerdo jugoso horneado lentamente, servido con salsa BBQ artesanal.',                   itemType:'protein',    porciones:0,  disponible:false },
        { id:'mock-p4', menuItemId:null, nombre:'Camarones al Ajillo',                        precio:22000, descripcion:'Camarones frescos salteados en mantequilla de ajo y limón, servidos sobre arroz.',              itemType:'a_la_carte', porciones:4,  disponible:true  },
        { id:'mock-s1', menuItemId:null, nombre:'Arroz Blanco con Coco',                      precio:0,     descripcion:'Arroz cocinado con leche de coco, acompañamiento clásico de la cocina colombiana.',             itemType:'side',       porciones:30, disponible:true  },
        { id:'mock-s2', menuItemId:null, nombre:'Fríjoles Rojos con Hogao',                   precio:0,     descripcion:'Fríjoles rojos cocinados a fuego lento con hogao de tomate y cebolla.',                         itemType:'side',       porciones:25, disponible:true  },
        { id:'mock-s3', menuItemId:null, nombre:'Patacón Tostado con Guacamole',              precio:0,     descripcion:'Plátano verde aplastado y frito dos veces, servido con guacamole fresco.',                       itemType:'side',       porciones:20, disponible:true  },
        { id:'mock-d1', menuItemId:null, nombre:'Jugo Natural del Día',                       precio:3000,  descripcion:'Fruta fresca de temporada preparada al momento — pregunta al mesero qué hay hoy.',              itemType:'drink',      porciones:30, disponible:true  },
        { id:'mock-d2', menuItemId:null, nombre:'Limonada de Panela',                         precio:3500,  descripcion:'Limón recién exprimido endulzado con panela orgánica y una pizca de sal.',                      itemType:'drink',      porciones:25, disponible:true  },
        { id:'mock-d3', menuItemId:null, nombre:'Agua Aromática de Hierbas',                  precio:2000,  descripcion:'Infusión de menta, hierba buena y canela servida fría o caliente.',                             itemType:'drink',      porciones:20, disponible:true  },
    ];

    renderizarCatsBar();
    renderizarMenu();
    mostrarMenu();
}

// ============================================================
// TIEMPO REAL — suscripción a cambios en el menú del día
// ============================================================
function suscribirTiempoReal() {
    if (!dailyMenuId) return;

    supabaseClient
        .channel('la26-menu-cliente-rt')
        .on('postgres_changes', {
            event:  '*',
            schema: 'public',
            table:  'daily_menu_slots',
            filter: `daily_menu_id=eq.${dailyMenuId}`,
        }, () => {
            console.log('[La 26] 🔄 Cambio en daily_menu_slots — recargando');
            cargarSlotsDesdeMenuDia();
        })
        .on('postgres_changes', {
            event:  'UPDATE',
            schema: 'public',
            table:  'menu_items',
            filter: `restaurant_id=eq.${restaurantId}`,
        }, () => {
            console.log('[La 26] 🔄 Cambio en menu_items — recargando');
            if (dailyMenuId) cargarSlotsDesdeMenuDia();
            else             cargarSlotsDesdeCatalogo();
        })
        .subscribe(status => console.log('[La 26] Canal RT:', status));
}

// ============================================================
// EVENT LISTENERS
// ============================================================
elOrderForm.addEventListener('submit', Order.submit.bind(Order));

// ============================================================
// PANEL MESERO — MeseroPanel v2.0
// ============================================================
// Activación: menu.html?modo=mesero
// Login con usuario/contraseña → Dashboard de mesas en tiempo real
// → Bottom sheet por mesa → Tomar pedido con carta completa
// → Realtime: orders, order_items, menu_items
// ============================================================

// ── CREDENCIALES HARDCODED (sin Supabase Auth) ──────────────
const MESERO_CREDS = { usuario: 'cliente', password: 'cliente26', nombre: 'Mesero', cargo: 'Mesero' };

// ── ESTADO DEL PANEL ────────────────────────────────────────
const MeseroState = {
    mesero:         null,   // { nombre, cargo }
    restaurantId:   null,
    mesas:          [],     // filas de la tabla tables
    pedidosActivos: [],     // orders activos del turno
    orderItems:     [],     // order_items de esos pedidos
    menuItems:      [],     // menu_items activos
    dailyMenuId:    null,
    slots:          [],     // slots del menú del día o catálogo
    mesaSeleccionada: null, // mesa abierta en el drawer
    carritoMesero:  [],     // [{ slotId, cantidad }]
    cronometroInterval: null,
    realtimeChannel: null,
    alertasAgotados: [],
};

// ── CSS DEL PANEL ───────────────────────────────────────────
const MESERO_CSS = `
    /* ════ ROOT DARK ════ */
    #mp-root {
        position:fixed;inset:0;background:#0f1010;z-index:10000;
        font-family:'DM Sans',sans-serif;color:#e8e8e2;
        display:flex;flex-direction:column;overflow:hidden;
    }
    #mp-root * { box-sizing:border-box; }

    /* ── KEYFRAMES ── */
    @keyframes mp-fadeup { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
    @keyframes mp-slidein { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
    @keyframes mp-slidedown { from{transform:translateY(-32px);opacity:0} to{transform:translateY(0);opacity:1} }
    @keyframes mp-pulse-green { 0%,100%{box-shadow:0 0 0 0 rgba(32,200,96,.45)} 50%{box-shadow:0 0 0 8px rgba(32,200,96,0)} }
    @keyframes mp-pulse-red { 0%,100%{opacity:1} 50%{opacity:0.45} }
    @keyframes mp-spin { to{transform:rotate(360deg)} }

    /* ── LOGIN ── */
    #mp-login {
        display:flex;align-items:center;justify-content:center;
        flex:1;padding:24px;
    }
    .mp-login-card {
        background:#1a1d1a;border:1px solid #2a2d2a;border-radius:24px;
        padding:36px 28px;width:min(400px,100%);
        box-shadow:0 24px 80px rgba(0,0,0,.6);
        animation:mp-fadeup .4s ease both;
    }
    .mp-login-logo {
        text-align:center;margin-bottom:28px;
    }
    .mp-login-logo h1 {
        font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:400;
        color:#e8e8e2;line-height:1.1;margin-bottom:4px;
    }
    .mp-login-logo h1 em { color:#8aad3a;font-style:italic; }
    .mp-login-logo p { font-size:11px;color:#78786e;letter-spacing:.1em;text-transform:uppercase; }
    .mp-field-label {
        font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
        color:#78786e;margin-bottom:6px;display:block;
    }
    .mp-input {
        width:100%;background:#0f1010;border:1.5px solid #2a2d2a;border-radius:12px;
        padding:12px 14px;font-size:14px;color:#e8e8e2;font-family:'DM Sans',sans-serif;
        outline:none;transition:border-color .2s,box-shadow .2s;margin-bottom:14px;
    }
    .mp-input:focus { border-color:#4a5a28;box-shadow:0 0 0 3px rgba(74,90,40,.18); }
    .mp-input::placeholder { color:#3a3d3a; }
    .mp-input-eye { position:relative; }
    .mp-input-eye .mp-input { padding-right:42px;margin-bottom:0; }
    .mp-eye-btn {
        position:absolute;right:12px;top:50%;transform:translateY(-50%);
        background:none;border:none;cursor:pointer;color:#78786e;padding:4px;
        font-size:16px;
    }
    .mp-btn-primary {
        width:100%;background:#4a5a28;border:none;border-radius:999px;
        padding:14px;color:#e8e8e2;font-size:14px;font-weight:600;cursor:pointer;
        font-family:'DM Sans',sans-serif;transition:background .2s;margin-top:6px;
    }
    .mp-btn-primary:hover { background:#5c7032; }
    .mp-btn-primary:disabled { background:#2a2d2a;color:#3a3d3a;cursor:not-allowed; }
    .mp-login-err {
        background:#2a1010;border:1px solid rgba(184,50,50,.3);border-radius:10px;
        padding:10px 14px;font-size:12.5px;color:#e07070;margin-bottom:14px;display:none;
    }

    /* ── PANEL PRINCIPAL ── */
    #mp-panel { display:flex;flex-direction:column;flex:1;overflow:hidden; }

    /* ── TOPBAR ── */
    .mp-topbar {
        background:#1a1d1a;border-bottom:1px solid #2a2d2a;
        padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;
    }
    .mp-topbar-logo {
        font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:400;
        color:#e8e8e2;flex:1;
    }
    .mp-topbar-logo em { color:#8aad3a;font-style:italic; }
    .mp-topbar-badge {
        background:#2a2d2a;border:1px solid #3a3d3a;border-radius:999px;
        padding:4px 12px;font-size:11px;color:#78786e;
    }
    .mp-btn-logout {
        background:none;border:1px solid #2a2d2a;color:#78786e;border-radius:999px;
        padding:5px 12px;font-size:11.5px;cursor:pointer;font-family:'DM Sans',sans-serif;
        transition:all .2s;
    }
    .mp-btn-logout:hover { border-color:#c05030;color:#e07060; }

    /* ── BARRA DE ALERTAS ── */
    #mp-alerts-bar {
        flex-shrink:0;background:#1a1200;border-bottom:1px solid #3a2a00;
        overflow:hidden;transition:max-height .3s ease;max-height:0;
    }
    #mp-alerts-bar.visible { max-height:200px; }
    .mp-alert-item {
        display:flex;align-items:center;gap:10px;padding:9px 16px;
        border-bottom:1px solid #2a1e00;animation:mp-slidedown .3s ease;
    }
    .mp-alert-item:last-child { border-bottom:none; }
    .mp-alert-item span { flex:1;font-size:12.5px;color:#e8c060; }
    .mp-alert-dismiss {
        background:none;border:none;color:#78786e;cursor:pointer;font-size:14px;padding:2px 6px;
    }

    /* ── GRID DE MESAS ── */
    #mp-grid-wrap {
        flex:1;overflow-y:auto;padding:16px;
        display:grid;
        grid-template-columns:repeat(2,1fr);
        gap:12px;
        align-content:start;
    }
    @media(min-width:600px){ #mp-grid-wrap{grid-template-columns:repeat(3,1fr);} }
    @media(min-width:900px){ #mp-grid-wrap{grid-template-columns:repeat(4,1fr);} }

    /* ── TARJETA MESA ── */
    .mp-mesa-card {
        border-radius:16px;padding:16px;cursor:pointer;
        border:1.5px solid #2a2d2a;background:#1a1d1a;
        transition:transform .15s,box-shadow .15s;
        animation:mp-fadeup .4s ease both;
        -webkit-tap-highlight-color:transparent;
        min-height:110px;display:flex;flex-direction:column;gap:6px;
    }
    .mp-mesa-card:active { transform:scale(0.96); }
    .mp-mesa-card.libre   { background:#0e1f0e;border-color:#2a4a2a; }
    .mp-mesa-card.pendiente { background:#1f1a08;border-color:#c8941a; }
    .mp-mesa-card.preparando { background:#1f1208;border-color:#e07020; }
    .mp-mesa-card.listo {
        background:#0a1f18;border-color:#20c860;
        animation:mp-pulse-green 1.8s ease-in-out infinite;
    }
    .mp-mesa-card.cuenta { background:#141414;border-color:#686868; }

    .mp-mesa-num {
        font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:400;
        line-height:1;color:#e8e8e2;
    }
    .mp-mesa-estado {
        font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    }
    .libre   .mp-mesa-estado { color:#4a9a4a; }
    .pendiente .mp-mesa-estado { color:#c8941a; }
    .preparando .mp-mesa-estado { color:#e07020; }
    .listo .mp-mesa-estado { color:#20c860; }
    .cuenta .mp-mesa-estado { color:#888; }

    .mp-mesa-info {
        font-size:12px;color:#78786e;margin-top:auto;
        display:flex;align-items:center;justify-content:space-between;gap:4px;
    }
    .mp-mesa-timer { font-size:11px;font-weight:600; }
    .mp-mesa-timer.verde { color:#4a9a4a; }
    .mp-mesa-timer.amarillo { color:#c8941a; }
    .mp-mesa-timer.naranja { color:#e07020; }
    .mp-mesa-timer.rojo { color:#e04040;animation:mp-pulse-red 1.4s ease-in-out infinite; }
    .mp-mesa-items { font-size:11px;color:#78786e; }

    /* ── LOADER PANEL ── */
    #mp-loader {
        flex:1;display:flex;align-items:center;justify-content:center;
        flex-direction:column;gap:14px;
    }
    .mp-spinner {
        width:36px;height:36px;border:2px solid #2a2d2a;border-top-color:#4a5a28;
        border-radius:50%;animation:mp-spin .8s linear infinite;
    }
    .mp-loader-txt { font-size:13px;color:#78786e; }

    /* ── DRAWER DE MESA ── */
    #mp-drawer-overlay {
        position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10100;
        display:none;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
    }
    #mp-drawer-overlay.open { display:block; }
    #mp-drawer {
        position:fixed;bottom:0;left:0;right:0;background:#1a1d1a;
        border-radius:20px 20px 0 0;max-height:92svh;display:flex;
        flex-direction:column;transform:translateY(100%);z-index:10101;
        transition:transform .35s cubic-bezier(0.16,1,0.3,1);
        border-top:1px solid #2a2d2a;
    }
    #mp-drawer.open { transform:translateY(0); }
    .mp-drawer-handle { display:flex;justify-content:center;padding:12px 0 0; }
    .mp-drawer-handle-bar { width:36px;height:4px;background:#2a2d2a;border-radius:999px; }
    .mp-drawer-header {
        padding:14px 20px 10px;border-bottom:1px solid #2a2d2a;flex-shrink:0;
    }
    .mp-drawer-title {
        font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:400;color:#e8e8e2;
        margin-bottom:3px;
    }
    .mp-drawer-sub { font-size:12px;color:#78786e; }
    .mp-drawer-body { flex:1;overflow-y:auto;padding:16px 20px; }
    .mp-drawer-actions {
        padding:12px 20px calc(12px + env(safe-area-inset-bottom));
        border-top:1px solid #2a2d2a;display:flex;gap:8px;flex-shrink:0;
    }

    /* ── ESTADO DEL ÍTEM ── */
    .mp-item-row {
        display:flex;align-items:center;gap:10px;padding:10px 0;
        border-bottom:1px solid #222;
    }
    .mp-item-row:last-child { border-bottom:none; }
    .mp-item-name { flex:1;font-size:13px;color:#e8e8e2;line-height:1.35; }
    .mp-item-qty { font-size:11.5px;color:#78786e;flex-shrink:0; }
    .mp-item-badge {
        font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
        padding:3px 9px;border-radius:999px;flex-shrink:0;
    }
    .mp-item-badge.pending { background:#2a2200;color:#c8941a;border:1px solid #4a3a00; }
    .mp-item-badge.preparing { background:#2a1200;color:#e07020;border:1px solid #5a2a00; }
    .mp-item-badge.ready { background:#0a2a18;color:#20c860;border:1px solid #0a5a2a; }
    .mp-item-badge.delivered { background:#1a1d1a;color:#3a3d3a;border:1px solid #2a2d2a; }

    /* ── BOTONES DRAWER ── */
    .mp-btn-accion {
        flex:1;padding:12px;border-radius:12px;border:1.5px solid #2a2d2a;
        background:#1a1d1a;color:#e8e8e2;font-size:12.5px;font-weight:600;
        cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .18s;
        text-align:center;
    }
    .mp-btn-accion:hover { background:#2a2d2a; }
    .mp-btn-accion.primary {
        background:#4a5a28;border-color:#4a5a28;color:#fff;
    }
    .mp-btn-accion.primary:hover { background:#5c7032; }
    .mp-btn-accion.danger { border-color:#4a1010;color:#e07060; }
    .mp-btn-accion.danger:hover { background:#2a1010; }

    /* ── PICKER DE CARTA (tomar pedido) ── */
    #mp-carta-overlay {
        position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10200;
        display:none;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
    }
    #mp-carta-overlay.open { display:flex;flex-direction:column; }
    #mp-carta-panel {
        position:absolute;bottom:0;left:0;right:0;background:#1a1d1a;
        border-radius:20px 20px 0 0;max-height:96svh;
        display:flex;flex-direction:column;
        border-top:1px solid #2a2d2a;
        transform:translateY(100%);transition:transform .35s cubic-bezier(0.16,1,0.3,1);
    }
    #mp-carta-panel.open { transform:translateY(0); }
    .mp-carta-header {
        padding:14px 20px 10px;border-bottom:1px solid #2a2d2a;flex-shrink:0;
    }
    .mp-carta-cats {
        display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;
        padding:10px 16px 12px;flex-shrink:0;border-bottom:1px solid #2a2d2a;
    }
    .mp-carta-cats::-webkit-scrollbar { display:none; }
    .mp-carta-cat-btn {
        flex-shrink:0;padding:6px 14px;border-radius:999px;border:1.5px solid #2a2d2a;
        background:#0f1010;color:#78786e;font-size:12px;font-weight:500;cursor:pointer;
        font-family:'DM Sans',sans-serif;transition:all .18s;white-space:nowrap;
    }
    .mp-carta-cat-btn.active {
        background:#4a5a28;border-color:#4a5a28;color:#fff;
    }
    .mp-carta-items { flex:1;overflow-y:auto;padding:12px 16px; }
    .mp-carta-item {
        display:flex;align-items:center;gap:12px;padding:12px 0;
        border-bottom:1px solid #1f221f;
    }
    .mp-carta-item:last-child { border-bottom:none; }
    .mp-carta-item-info { flex:1;min-width:0; }
    .mp-carta-item-name { font-size:13.5px;color:#e8e8e2;font-weight:500;margin-bottom:2px; }
    .mp-carta-item-precio {
        font-family:'Cormorant Garamond',serif;font-size:1rem;color:#8aad3a;
    }
    .mp-carta-item-precio.incluido {
        font-family:'DM Sans',sans-serif;font-size:11px;color:#78786e;
    }
    .mp-carta-qty {
        display:flex;align-items:center;gap:6px;
    }
    .mp-carta-qty button {
        width:30px;height:30px;border-radius:50%;border:1.5px solid #2a2d2a;
        background:#0f1010;color:#e8e8e2;font-size:16px;font-weight:300;
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        transition:all .15s;
    }
    .mp-carta-qty button:hover { background:#2a2d2a; }
    .mp-carta-qty span { min-width:24px;text-align:center;font-size:13px;font-weight:600;color:#e8e8e2; }
    .mp-carta-footer {
        padding:12px 16px calc(12px + env(safe-area-inset-bottom));
        border-top:1px solid #2a2d2a;flex-shrink:0;
    }
    .mp-carta-resumen {
        display:flex;align-items:center;justify-content:space-between;
        margin-bottom:10px;font-size:12.5px;color:#78786e;
    }
    .mp-carta-total {
        font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:#e8e8e2;
    }
    .mp-carta-cliente-input {
        width:100%;background:#0f1010;border:1.5px solid #2a2d2a;border-radius:12px;
        padding:10px 14px;font-size:13.5px;color:#e8e8e2;font-family:'DM Sans',sans-serif;
        outline:none;transition:border-color .2s;margin-bottom:10px;
    }
    .mp-carta-cliente-input:focus { border-color:#4a5a28; }
    .mp-carta-cliente-input::placeholder { color:#3a3d3a; }

    /* ── HISTORIAL ── */
    .mp-historial-section { margin-top:16px; }
    .mp-historial-title {
        font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
        color:#3a3d3a;margin-bottom:8px;
    }
    .mp-historial-row {
        background:#0f1010;border:1px solid #1f221f;border-radius:10px;
        padding:10px 12px;margin-bottom:6px;
    }
    .mp-historial-ref { font-size:11px;color:#3a3d3a;font-family:'Courier New',monospace; }
    .mp-historial-estado {
        font-size:11px;font-weight:600;
        display:inline-block;margin-left:8px;
    }

    /* ── EMPTY STATE ── */
    .mp-empty { text-align:center;padding:32px 0;color:#3a3d3a;font-size:13px; }

    /* ── TOAST MESERO ── */
    #mp-toast-container {
        position:fixed;top:16px;left:50%;transform:translateX(-50%);
        z-index:10500;display:flex;flex-direction:column;gap:7px;align-items:center;
        pointer-events:none;width:max-content;max-width:calc(100vw - 24px);
    }
`;

// ── UTILIDADES ──────────────────────────────────────────────
function mpFormatCOP(v) { return '$' + Math.round(v).toLocaleString('es-CO'); }
function mpTodayISO() { return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'}); }
function mpMinutos(fechaStr) {
    if (!fechaStr) return 0;
    return Math.floor((Date.now() - new Date(fechaStr).getTime()) / 60000);
}
function mpColorTimer(min) {
    if (min < 5)  return 'verde';
    if (min < 15) return 'amarillo';
    if (min < 25) return 'naranja';
    return 'rojo';
}
function mpToast(msg, tipo='info', ms=3800) {
    let cont = document.getElementById('mp-toast-container');
    if (!cont) {
        cont = document.createElement('div');
        cont.id = 'mp-toast-container';
        document.body.appendChild(cont);
    }
    const c = { ok:{bg:'#1a2a14',border:'rgba(74,160,60,.4)',text:'#7ad060'},
                error:{bg:'#2a1010',border:'rgba(200,60,40,.4)',text:'#e07060'},
                info:{bg:'#1a1d1a',border:'rgba(74,90,40,.4)',text:'#c8d090'} }[tipo] || {};
    const t = document.createElement('div');
    Object.assign(t.style,{
        background:c.bg,border:`1.5px solid ${c.border}`,borderRadius:'999px',
        padding:'9px 18px',color:c.text,fontSize:'13px',fontFamily:"'DM Sans',sans-serif",
        fontWeight:'500',opacity:'0',transform:'translateY(-6px)',
        transition:'opacity .25s,transform .25s',pointerEvents:'auto',
        whiteSpace:'pre-wrap',maxWidth:'calc(100vw - 24px)',boxShadow:'0 4px 20px rgba(0,0,0,.4)',
    });
    t.textContent = msg;
    cont.appendChild(t);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
        t.style.opacity='1';t.style.transform='translateY(0)';
    }));
    const timer = setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),280); }, ms);
    t.onclick=()=>{ clearTimeout(timer);t.remove(); };
}

// ── BOOTSTRAP ───────────────────────────────────────────────
const MeseroPanel = (function() {

    function _injectCSS() {
        if (document.getElementById('mp-css')) return;
        const s = document.createElement('style');
        s.id = 'mp-css'; s.textContent = MESERO_CSS;
        document.head.appendChild(s);
    }

    function _mount() {
        let root = document.getElementById('mp-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'mp-root';
            document.body.appendChild(root);
        }
        root.innerHTML = `
            <!-- LOGIN -->
            <div id="mp-login">
                <div class="mp-login-card">
                    <div class="mp-login-logo">
                        <h1>Restaurante <em>la 26</em></h1>
                        <p>Panel del Mesero</p>
                    </div>
                    <div id="mp-login-err" class="mp-login-err"></div>
                    <label class="mp-field-label">Usuario</label>
                    <input id="mp-user" class="mp-input" type="text"
                        placeholder="usuario" autocomplete="username"
                        onkeydown="if(event.key==='Enter')document.getElementById('mp-pass').focus()">
                    <label class="mp-field-label" style="margin-top:4px;">Contraseña</label>
                    <div class="mp-input-eye" style="margin-bottom:14px;">
                        <input id="mp-pass" class="mp-input" type="password"
                            placeholder="••••••" autocomplete="current-password"
                            onkeydown="if(event.key==='Enter')MeseroPanel.login()">
                        <button class="mp-eye-btn" onclick="MeseroPanel.togglePass()" id="mp-eye-btn">👁️</button>
                    </div>
                    <button class="mp-btn-primary" onclick="MeseroPanel.login()">Ingresar al turno</button>
                </div>
            </div>

            <!-- PANEL PRINCIPAL (oculto hasta login) -->
            <div id="mp-panel" style="display:none;">
                <div class="mp-topbar">
                    <span class="mp-topbar-logo">Restaurante <em>la 26</em></span>
                    <span class="mp-topbar-badge" id="mp-topbar-mesero">—</span>
                    <button class="mp-btn-logout" onclick="MeseroPanel.logout()">Salir</button>
                </div>
                <div id="mp-alerts-bar"></div>
                <div id="mp-loader">
                    <div class="mp-spinner"></div>
                    <p class="mp-loader-txt">Cargando mesas…</p>
                </div>
                <div id="mp-grid-wrap" style="display:none;"></div>
            </div>

            <!-- DRAWER DE MESA -->
            <div id="mp-drawer-overlay" onclick="MeseroPanel.cerrarDrawer()"></div>
            <div id="mp-drawer">
                <div class="mp-drawer-handle"><div class="mp-drawer-handle-bar"></div></div>
                <div class="mp-drawer-header">
                    <div class="mp-drawer-title" id="mp-drawer-title">Mesa</div>
                    <div class="mp-drawer-sub" id="mp-drawer-sub"></div>
                </div>
                <div class="mp-drawer-body" id="mp-drawer-body"></div>
                <div class="mp-drawer-actions" id="mp-drawer-actions"></div>
            </div>

            <!-- OVERLAY DE CARTA (tomar pedido) -->
            <div id="mp-carta-overlay" onclick="if(event.target===this)MeseroPanel.cerrarCarta()">
                <div id="mp-carta-panel">
                    <div class="mp-drawer-handle"><div class="mp-drawer-handle-bar"></div></div>
                    <div class="mp-carta-header">
                        <div style="font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:400;color:#e8e8e2;" id="mp-carta-title">Nuevo Pedido</div>
                        <div style="font-size:12px;color:#78786e;" id="mp-carta-sub"></div>
                    </div>
                    <div class="mp-carta-cats" id="mp-carta-cats"></div>
                    <div class="mp-carta-items" id="mp-carta-items"></div>
                    <div class="mp-carta-footer">
                        <div class="mp-carta-resumen">
                            <span id="mp-carta-count">0 platos</span>
                            <span class="mp-carta-total" id="mp-carta-total-val">$0</span>
                        </div>
                        <input id="mp-carta-cliente" class="mp-carta-cliente-input"
                            type="text" placeholder="Nombre del cliente (opcional)">
                        <button class="mp-btn-primary" id="mp-carta-submit"
                            onclick="MeseroPanel.enviarPedido()">Enviar a cocina</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ── LOGIN ───────────────────────────────────────────────
    function login() {
        const user = document.getElementById('mp-user')?.value.trim();
        const pass = document.getElementById('mp-pass')?.value;
        const err  = document.getElementById('mp-login-err');
        if (user === MESERO_CREDS.usuario && pass === MESERO_CREDS.password) {
            MeseroState.mesero = { nombre: MESERO_CREDS.nombre, cargo: MESERO_CREDS.cargo };
            sessionStorage.setItem('meseroNombre', MESERO_CREDS.nombre);
            sessionStorage.setItem('meseroCargo',  MESERO_CREDS.cargo);
            document.getElementById('mp-login').style.display  = 'none';
            document.getElementById('mp-panel').style.display  = 'flex';
            document.getElementById('mp-topbar-mesero').textContent = MESERO_CREDS.cargo;
            iniciarPanel();
        } else {
            err.textContent = 'Usuario o contraseña incorrectos.';
            err.style.display = 'block';
        }
    }

    function togglePass() {
        const inp = document.getElementById('mp-pass');
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
    }

    function logout() {
        sessionStorage.removeItem('meseroNombre');
        sessionStorage.removeItem('meseroCargo');
        if (MeseroState.cronometroInterval) clearInterval(MeseroState.cronometroInterval);
        if (MeseroState.realtimeChannel) {
            supabaseClient.removeChannel(MeseroState.realtimeChannel);
            MeseroState.realtimeChannel = null;
        }
        document.getElementById('mp-panel').style.display = 'none';
        document.getElementById('mp-login').style.display = 'flex';
        document.getElementById('mp-user').value = '';
        document.getElementById('mp-pass').value = '';
    }

    // ── CARGA INICIAL ────────────────────────────────────────
    async function iniciarPanel() {
        mostrarLoader(true);

        // Resolver restaurant_id
        if (!MeseroState.restaurantId) {
            MeseroState.restaurantId = await resolverRestaurantId();
        }
        if (!MeseroState.restaurantId) {
            mpToast('No se pudo conectar al restaurante.','error');
            mostrarLoader(false);
            return;
        }

        // Cargar mesas
        const { data: tablasData } = await supabaseClient
            .from('tables')
            .select('id, number, label, capacity')
            .eq('restaurant_id', MeseroState.restaurantId)
            .order('number', { ascending: true });

        MeseroState.mesas = (tablasData || []).filter(t =>
            !String(t.label || '').toLowerCase().includes('para llevar') &&
            !String(t.label || '').toLowerCase().includes('domicilio')
        );

        // Cargar pedidos activos del turno
        await recargarPedidos();

        // Cargar menú del día para picker de carta
        await cargarMenuMesero();

        // Iniciar realtime
        iniciarRealtime();

        // Cronómetro cada 30s
        MeseroState.cronometroInterval = setInterval(renderGrid, 30000);

        mostrarLoader(false);
        renderGrid();
    }

    async function recargarPedidos() {
        const hoy = mpTodayISO();
        const { data: ords } = await supabaseClient
            .from('orders')
            .select('id, table_id, status, customer_name, order_number, created_at, total_amount, notes')
            .eq('restaurant_id', MeseroState.restaurantId)
            .not('status', 'in', '("delivered","cancelled")')
            .gte('created_at', `${hoy}T00:00:00`)
            .order('created_at', { ascending: false });

        MeseroState.pedidosActivos = ords || [];

        if (MeseroState.pedidosActivos.length > 0) {
            const ids = MeseroState.pedidosActivos.map(o => o.id);
            const { data: items } = await supabaseClient
                .from('order_items')
                .select('id, order_id, menu_item_id, quantity, item_status, notes, unit_price')
                .in('order_id', ids);
            MeseroState.orderItems = items || [];
        } else {
            MeseroState.orderItems = [];
        }
    }

    async function cargarMenuMesero() {
        const hoy = mpTodayISO();
        const { data: dm } = await supabaseClient
            .from('daily_menus')
            .select('id')
            .eq('restaurant_id', MeseroState.restaurantId)
            .eq('menu_date', hoy)
            .eq('is_published', true)
            .maybeSingle();

        if (dm?.id) {
            MeseroState.dailyMenuId = dm.id;
            const { data: rawSlots } = await supabaseClient
                .from('daily_menu_slots_availability')
                .select('id,menu_item_id,item_name,price,item_type,is_truly_available,portions_available,portions_sold')
                .eq('daily_menu_id', dm.id)
                .in('item_type',['executive_lunch','a_la_carte','drink','dessert','side'])
                .order('category_order',{ascending:true})
                .order('display_order',{ascending:true});

            MeseroState.slots = (rawSlots||[]).map(s=>({
                id: s.id,
                menuItemId: s.menu_item_id,
                nombre: s.item_name,
                precio: Number(s.price)||0,
                itemType: s.item_type,
                disponible: Boolean(s.is_truly_available),
                porciones: Math.max(0,(s.portions_available||0)-(s.portions_sold||0)),
            }));
        } else {
            MeseroState.dailyMenuId = null;
            const { data: items } = await supabaseClient
                .from('menu_items')
                .select('id,name,price,item_type,description')
                .eq('restaurant_id', MeseroState.restaurantId)
                .eq('is_active', true)
                .in('item_type',['executive_lunch','a_la_carte','drink','dessert','side'])
                .order('name',{ascending:true});

            MeseroState.slots = (items||[]).map(i=>({
                id: i.id, menuItemId: i.id, nombre: i.name,
                precio: Number(i.price)||0, itemType: i.item_type,
                disponible: true, porciones: 999,
            }));
        }
    }

    // ── REALTIME ─────────────────────────────────────────────
    function iniciarRealtime() {
        if (MeseroState.realtimeChannel) {
            supabaseClient.removeChannel(MeseroState.realtimeChannel);
        }
        MeseroState.realtimeChannel = supabaseClient
            .channel('panel-mesero-v2')
            .on('postgres_changes',{event:'*',schema:'public',table:'orders'},
                async (payload) => {
                    await recargarPedidos();
                    renderGrid();
                    // Si el drawer de esa mesa está abierto, refrescar
                    if (MeseroState.mesaSeleccionada) {
                        const mesa = MeseroState.mesas.find(m=>m.id===MeseroState.mesaSeleccionada);
                        if (mesa) renderDrawer(mesa);
                    }
                    // Vibrar si algún pedido de la mesa pasó a ready
                    if (payload.new?.status === 'ready' || payload.eventType === 'UPDATE') {
                        const estadoNuevo = calcularEstadoMesa(payload.new?.table_id);
                        if (estadoNuevo === 'listo' && 'vibrate' in navigator) {
                            navigator.vibrate([200,100,200]);
                        }
                    }
                })
            .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},
                async () => {
                    await recargarPedidos();
                    renderGrid();
                    if (MeseroState.mesaSeleccionada) {
                        const mesa = MeseroState.mesas.find(m=>m.id===MeseroState.mesaSeleccionada);
                        if (mesa) renderDrawer(mesa);
                    }
                })
            .on('postgres_changes',{event:'UPDATE',schema:'public',table:'menu_items'},
                (payload) => {
                    if (payload.new?.is_active === false) {
                        mostrarAlertaAgotado(payload.new?.name || 'Plato');
                    }
                })
            .subscribe();
    }

    // ── LÓGICA DE ESTADO DE MESA ─────────────────────────────
    function calcularEstadoMesa(tableId) {
        const pedidos = MeseroState.pedidosActivos.filter(o => o.table_id === tableId);
        if (!pedidos.length) return 'libre';

        // cuenta pendiente manualmente marcada
        const tieneCuenta = pedidos.some(o => o.status === 'cuenta');
        if (tieneCuenta) return 'cuenta';

        const items = MeseroState.orderItems.filter(i =>
            pedidos.some(o => o.id === i.order_id)
        );
        if (!items.length) {
            // hay pedido pero sin ítems aún — pendiente
            const todosPending = pedidos.every(o => o.status === 'pending');
            if (todosPending) return 'pendiente';
            return 'preparando';
        }

        const statuses = items.map(i => i.item_status || 'pending');
        const todosReady     = statuses.every(s => s === 'ready' || s === 'delivered');
        const algunoReady    = statuses.some(s => s === 'ready');
        const algunoPrep     = statuses.some(s => s === 'preparing');
        const todosPending   = statuses.every(s => s === 'pending');

        if (todosReady)  return 'listo';
        if (algunoPrep || algunoReady) return 'preparando';
        if (todosPending) return 'pendiente';
        return 'pendiente';
    }

    function labelEstado(e) {
        return {libre:'Libre',pendiente:'Esperando cocina',preparando:'En preparación',
                listo:'Listo para servir',cuenta:'Esperando cuenta'}[e] || e;
    }

    function ultimoPedido(tableId) {
        const pedidos = MeseroState.pedidosActivos.filter(o => o.table_id === tableId);
        if (!pedidos.length) return null;
        return pedidos.sort((a,b) => new Date(b.created_at)-new Date(a.created_at))[0];
    }

    function itemsActivosDeMesa(tableId) {
        const pedidos = MeseroState.pedidosActivos.filter(o => o.table_id === tableId);
        return MeseroState.orderItems.filter(i => pedidos.some(o => o.id === i.order_id));
    }

    // ── RENDER GRID ──────────────────────────────────────────
    function renderGrid() {
        const grid = document.getElementById('mp-grid-wrap');
        if (!grid) return;
        grid.innerHTML = '';

        if (!MeseroState.mesas.length) {
            grid.innerHTML = '<div class="mp-empty" style="grid-column:1/-1">Sin mesas registradas.</div>';
            return;
        }

        MeseroState.mesas.forEach((mesa, idx) => {
            const estado = calcularEstadoMesa(mesa.id);
            const ultimo = ultimoPedido(mesa.id);
            const minTrans = ultimo ? mpMinutos(ultimo.created_at) : 0;
            const colorTimer = mpColorTimer(minTrans);
            const timerTxt = ultimo ? (minTrans < 1 ? 'ahora' : `hace ${minTrans} min`) : '';
            const numItems = itemsActivosDeMesa(mesa.id).length;
            const clienteNombre = ultimo?.customer_name || '';
            const label = mesa.label || `Mesa ${mesa.number}`;

            const card = document.createElement('div');
            card.className = `mp-mesa-card ${estado}`;
            card.style.animationDelay = `${idx * 0.04}s`;
            card.onclick = () => abrirDrawer(mesa.id);
            card.innerHTML = `
                <div class="mp-mesa-num">${label}</div>
                <div class="mp-mesa-estado">${labelEstado(estado)}</div>
                <div class="mp-mesa-info">
                    <span class="mp-mesa-timer ${timerTxt ? colorTimer : ''}">
                        ${timerTxt || '—'}
                    </span>
                    ${numItems ? `<span class="mp-mesa-items">${numItems} ítem${numItems!==1?'s':''}</span>` : ''}
                </div>
                ${clienteNombre ? `<div style="font-size:11px;color:#78786e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${clienteNombre}</div>` : ''}
            `;
            grid.appendChild(card);
        });
    }

    function mostrarLoader(visible) {
        const loader = document.getElementById('mp-loader');
        const grid   = document.getElementById('mp-grid-wrap');
        if (loader) loader.style.display = visible ? 'flex' : 'none';
        if (grid)   grid.style.display   = visible ? 'none' : 'grid';
    }

    // ── DRAWER ───────────────────────────────────────────────
    function abrirDrawer(tableId) {
        MeseroState.mesaSeleccionada = tableId;
        const mesa = MeseroState.mesas.find(m => m.id === tableId);
        if (!mesa) return;
        renderDrawer(mesa);
        document.getElementById('mp-drawer-overlay').classList.add('open');
        setTimeout(() => document.getElementById('mp-drawer').classList.add('open'), 10);
    }

    function cerrarDrawer() {
        document.getElementById('mp-drawer').classList.remove('open');
        document.getElementById('mp-drawer-overlay').classList.remove('open');
        setTimeout(() => { MeseroState.mesaSeleccionada = null; }, 360);
    }

    function renderDrawer(mesa) {
        const label = mesa.label || `Mesa ${mesa.number}`;
        const estado = calcularEstadoMesa(mesa.id);
        const pedidos = MeseroState.pedidosActivos.filter(o => o.table_id === mesa.id);
        const items   = itemsActivosDeMesa(mesa.id);

        document.getElementById('mp-drawer-title').textContent = label;
        document.getElementById('mp-drawer-sub').textContent =
            `${labelEstado(estado)} · ${pedidos.length} pedido${pedidos.length!==1?'s':''} activos`;

        // ── BODY: ítems activos ──
        const body = document.getElementById('mp-drawer-body');
        body.innerHTML = '';

        if (items.length) {
            const secTitle = document.createElement('div');
            secTitle.className = 'mp-historial-title';
            secTitle.textContent = 'PEDIDO ACTUAL';
            body.appendChild(secTitle);

            items.forEach(item => {
                const nombreItem = (item.notes || '').replace('[nombre]','') ||
                                   `Ítem #${item.menu_item_id?.slice(-4)||'?'}`;
                const row = document.createElement('div');
                row.className = 'mp-item-row';
                const status = item.item_status || 'pending';
                const badgeTxt = {pending:'Pendiente',preparing:'Preparando',
                                  ready:'Listo ✓',delivered:'Entregado'}[status]||status;
                row.innerHTML = `
                    <div class="mp-item-name">${nombreItem}</div>
                    <div class="mp-item-qty">×${item.quantity}</div>
                    <span class="mp-item-badge ${status}">${badgeTxt}</span>
                `;
                body.appendChild(row);
            });
        } else if (pedidos.length === 0) {
            body.innerHTML = '<div class="mp-empty">Mesa libre — sin pedidos activos.</div>';
        } else {
            body.innerHTML = '<div class="mp-empty">Pedido registrado — sin ítems aún.</div>';
        }

        // ── Historial del turno ──
        if (pedidos.length) {
            const hist = document.createElement('div');
            hist.className = 'mp-historial-section';
            hist.innerHTML = '<div class="mp-historial-title">HISTORIAL DEL TURNO</div>';
            pedidos.forEach(ped => {
                const row = document.createElement('div');
                row.className = 'mp-historial-row';
                const estadoColor = {pending:'#c8941a',preparing:'#e07020',ready:'#20c860',
                                      delivered:'#3a3d3a',cancelled:'#e04040',cuenta:'#888'}[ped.status]||'#78786e';
                row.innerHTML = `
                    <span class="mp-historial-ref">${ped.order_number}</span>
                    <span class="mp-historial-estado" style="color:${estadoColor}">
                        ${labelEstado(ped.status)||ped.status}
                    </span>
                    <div style="font-size:11px;color:#3a3d3a;margin-top:3px;">
                        ${ped.customer_name||'—'} · ${mpFormatCOP(ped.total_amount||0)}
                    </div>
                `;
                hist.appendChild(row);
            });
            body.appendChild(hist);
        }

        // ── ACCIONES ──
        const actions = document.getElementById('mp-drawer-actions');
        actions.innerHTML = '';

        const btnNuevo = document.createElement('button');
        btnNuevo.className = 'mp-btn-accion primary';
        btnNuevo.innerHTML = '➕ Nuevo pedido';
        btnNuevo.onclick = () => {
            cerrarDrawer();
            setTimeout(() => abrirCarta(mesa.id), 360);
        };
        actions.appendChild(btnNuevo);

        if (estado !== 'libre') {
            const btnLiberar = document.createElement('button');
            btnLiberar.className = 'mp-btn-accion danger';
            btnLiberar.innerHTML = '🔓 Liberar';
            btnLiberar.onclick = () => liberarMesa(mesa.id);
            actions.appendChild(btnLiberar);
        }
    }

    async function liberarMesa(tableId) {
        // Marcar todos los pedidos activos de la mesa como delivered
        const pedidos = MeseroState.pedidosActivos.filter(o => o.table_id === tableId);
        if (!pedidos.length) { cerrarDrawer(); return; }
        const ids = pedidos.map(o => o.id);
        await supabaseClient.from('orders').update({status:'delivered'}).in('id', ids);
        cerrarDrawer();
        mpToast('Mesa liberada.','ok');
        await recargarPedidos();
        renderGrid();
    }

    // ── CARTA PARA TOMAR PEDIDO ──────────────────────────────
    let _cartaMesaId = null;
    let _cartaFiltro = 'todos';

    function abrirCarta(tableId) {
        _cartaMesaId = tableId;
        _cartaFiltro = 'todos';
        MeseroState.carritoMesero = [];
        const mesa = MeseroState.mesas.find(m => m.id === tableId);
        const label = mesa?.label || (mesa ? `Mesa ${mesa.number}` : 'Mesa');
        document.getElementById('mp-carta-title').textContent = `Nuevo Pedido`;
        document.getElementById('mp-carta-sub').textContent   = label;
        document.getElementById('mp-carta-cliente').value     = '';
        renderCartaCats();
        renderCartaItems();
        document.getElementById('mp-carta-overlay').classList.add('open');
        setTimeout(()=>document.getElementById('mp-carta-panel').classList.add('open'),10);
    }

    function cerrarCarta() {
        document.getElementById('mp-carta-panel').classList.remove('open');
        setTimeout(()=>document.getElementById('mp-carta-overlay').classList.remove('open'),360);
        _cartaMesaId = null;
        MeseroState.carritoMesero = [];
    }

    function renderCartaCats() {
        const cont = document.getElementById('mp-carta-cats');
        if (!cont) return;
        cont.innerHTML = '';

        const cats = [
            {id:'todos',label:'Todos'},
            {id:'executive_lunch',label:'🥩 Proteína'},
            {id:'side',label:'🍲 Principio'},
            {id:'drink',label:'🥤 Bebida'},
            {id:'a_la_carte',label:'✨ A la Carta'},
            {id:'dessert',label:'🍮 Postre'},
        ];
        const tiposPresentes = new Set(MeseroState.slots.map(s=>s.itemType));
        cats.filter(c=>c.id==='todos'||tiposPresentes.has(c.id)).forEach(cat=>{
            const btn = document.createElement('button');
            btn.className = `mp-carta-cat-btn${_cartaFiltro===cat.id?' active':''}`;
            btn.textContent = cat.label;
            btn.onclick = ()=>{ _cartaFiltro=cat.id; renderCartaCats(); renderCartaItems(); };
            cont.appendChild(btn);
        });
    }

    function renderCartaItems() {
        const cont = document.getElementById('mp-carta-items');
        if (!cont) return;
        const lista = _cartaFiltro==='todos'
            ? MeseroState.slots
            : MeseroState.slots.filter(s=>s.itemType===_cartaFiltro);

        cont.innerHTML = '';
        if (!lista.length) {
            cont.innerHTML = '<div class="mp-empty">Sin platos en esta categoría.</div>';
            return;
        }
        lista.forEach(slot=>{
            const enCarrito = MeseroState.carritoMesero.find(c=>c.slotId===slot.id);
            const qty = enCarrito?.cantidad || 0;
            const disponible = slot.disponible;
            const div = document.createElement('div');
            div.className = 'mp-carta-item';
            div.id = `mp-ci-${slot.id}`;
            div.innerHTML = `
                <div class="mp-carta-item-info">
                    <div class="mp-carta-item-name" style="${!disponible?'opacity:.4;text-decoration:line-through':''}">${slot.nombre}</div>
                    <div class="${slot.precio>0?'mp-carta-item-precio':'mp-carta-item-precio incluido'}">
                        ${slot.precio>0?mpFormatCOP(slot.precio):'Incluido'}
                        ${!disponible?'<span style="font-size:10px;color:#e04040;font-family:DM Sans"> · Agotado</span>':''}
                    </div>
                </div>
                ${disponible?`<div class="mp-carta-qty">
                    <button onclick="MeseroPanel.cartaQty('${slot.id}',-1)" ${qty===0?'style="opacity:.35"':''}>−</button>
                    <span>${qty}</span>
                    <button onclick="MeseroPanel.cartaQty('${slot.id}',+1)">+</button>
                </div>`:''}
            `;
            cont.appendChild(div);
        });
        actualizarCartaTotal();
    }

    function cartaQty(slotId, delta) {
        const slot = MeseroState.slots.find(s=>s.id===slotId);
        if (!slot||!slot.disponible) return;
        const idx = MeseroState.carritoMesero.findIndex(c=>c.slotId===slotId);
        if (idx===-1 && delta>0) {
            MeseroState.carritoMesero.push({slotId, cantidad:1});
        } else if (idx!==-1) {
            const nueva = MeseroState.carritoMesero[idx].cantidad + delta;
            if (nueva<=0) MeseroState.carritoMesero.splice(idx,1);
            else MeseroState.carritoMesero[idx].cantidad = nueva;
        }
        // Refrescar sólo la tarjeta tocada
        const enC = MeseroState.carritoMesero.find(c=>c.slotId===slotId);
        const qty = enC?.cantidad||0;
        const cell = document.getElementById(`mp-ci-${slotId}`);
        if (cell) {
            const qtyEl = cell.querySelector('.mp-carta-qty span');
            if (qtyEl) qtyEl.textContent = qty;
            const minusBtn = cell.querySelector('.mp-carta-qty button:first-child');
            if (minusBtn) minusBtn.style.opacity = qty===0?'.35':'1';
        }
        actualizarCartaTotal();
    }

    function actualizarCartaTotal() {
        const total = MeseroState.carritoMesero.reduce((acc,c)=>{
            const s = MeseroState.slots.find(sl=>sl.id===c.slotId);
            return acc + (s?s.precio*c.cantidad:0);
        },0);
        const count = MeseroState.carritoMesero.reduce((acc,c)=>acc+c.cantidad,0);
        document.getElementById('mp-carta-count').textContent = `${count} plato${count!==1?'s':''}`;
        document.getElementById('mp-carta-total-val').textContent = mpFormatCOP(total);
        const btn = document.getElementById('mp-carta-submit');
        if (btn) btn.disabled = count===0;
    }

    async function enviarPedido() {
        const carrito = MeseroState.carritoMesero;
        if (!carrito.length) return;

        const btn = document.getElementById('mp-carta-submit');
        if (btn) { btn.disabled=true; btn.textContent='Enviando…'; }

        const cliente = document.getElementById('mp-carta-cliente')?.value.trim() || '';
        const mesa = MeseroState.mesas.find(m => m.id === _cartaMesaId);
        const mesaLabel = mesa?.label || (mesa?`Mesa ${mesa.number}`:'Mesa');

        const orderNumber = `MES-LA26-${Date.now()}`;
        const total = carrito.reduce((a,c)=>{
            const s=MeseroState.slots.find(sl=>sl.id===c.slotId);
            return a+(s?s.precio*c.cantidad:0);
        },0);

        try {
            const { data: orden, error: errOrd } = await supabaseClient
                .from('orders')
                .insert([{
                    restaurant_id: MeseroState.restaurantId,
                    table_id:      _cartaMesaId,
                    order_number:  orderNumber,
                    status:        'pending',
                    customer_name: cliente||null,
                    notes:         `[${mesaLabel}] [Mesero: ${MeseroState.mesero?.nombre||'Mesero'}]`,
                    total_amount:  total,
                    daily_menu_id: MeseroState.dailyMenuId||null,
                }])
                .select('id')
                .single();

            if (errOrd) throw errOrd;

            const orderItems = carrito.map(c=>{
                const s = MeseroState.slots.find(sl=>sl.id===c.slotId);
                return {
                    order_id:           orden.id,
                    menu_item_id:       s?.menuItemId||s?.id,
                    daily_menu_slot_id: MeseroState.dailyMenuId ? c.slotId : null,
                    quantity:           c.cantidad,
                    unit_price:         s?.precio||0,
                    item_status:        'pending',
                    notes:              `[nombre]${s?.nombre||''}`,
                };
            });

            const { error: errItems } = await supabaseClient.from('order_items').insert(orderItems);
            if (errItems) console.warn('[MeseroPanel] order_items error:', errItems);

            cerrarCarta();
            mpToast(`✅ Pedido enviado a cocina — ${orderNumber}`,'ok',4000);
            await recargarPedidos();
            renderGrid();

        } catch(e) {
            console.error('[MeseroPanel] enviarPedido error:', e);
            mpToast(`Error: ${e?.message||'Inténtalo de nuevo.'}`,'error',5000);
            if (btn) { btn.disabled=false; btn.textContent='Enviar a cocina'; }
        }
    }

    // ── ALERTAS DE AGOTADOS ──────────────────────────────────
    function mostrarAlertaAgotado(nombre) {
        const bar = document.getElementById('mp-alerts-bar');
        if (!bar) return;
        bar.classList.add('visible');
        const item = document.createElement('div');
        item.className = 'mp-alert-item';
        item.innerHTML = `
            <span>⚠️ <strong>${nombre}</strong> se agotó — ya no está disponible</span>
            <button class="mp-alert-dismiss" onclick="this.parentElement.remove();
                if(!document.getElementById('mp-alerts-bar').children.length)
                    document.getElementById('mp-alerts-bar').classList.remove('visible')">✕</button>
        `;
        bar.appendChild(item);
        setTimeout(()=>{
            item.remove();
            if (!bar.children.length) bar.classList.remove('visible');
        }, 8000);
    }

    // ── API PÚBLICA ──────────────────────────────────────────
    return {
        init() {
            _injectCSS();
            _mount();
            // Recuperar sesión si ya estaba logueado
            const n = sessionStorage.getItem('meseroNombre');
            const c = sessionStorage.getItem('meseroCargo');
            if (n && c) {
                MeseroState.mesero = { nombre: n, cargo: c };
                document.getElementById('mp-login').style.display  = 'none';
                document.getElementById('mp-panel').style.display  = 'flex';
                document.getElementById('mp-topbar-mesero').textContent = c;
                iniciarPanel();
            }
        },
        login, logout, togglePass,
        cerrarDrawer, cerrarCarta,
        cartaQty, enviarPedido,
    };
})();


// ── MODO MESERO: activar si ?modo=mesero ────────────────────
const _MODO_MESERO = new URLSearchParams(window.location.search).get('modo') === 'mesero';

(function() {
    if (!_MODO_MESERO) return;
    function _activar() {
        ['app-loader','app-menu','cart-bar','mesa-welcome-modal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        MeseroPanel.init();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _activar, { once: true });
    } else {
        _activar();
    }
})();


// ============================================================
// CARGA DE DATOS — FLUJO PRINCIPAL
// ============================================================
async function cargarMenu() {
    mostrarLoader();

    // ── 0. GUARD: Verificar si el sistema está habilitado por el admin ─────
    // Lee la tabla system_settings en Supabase. Si orders_enabled === 'false',
    // muestra pantalla de "fuera de servicio" y bloquea el flujo.
    try {
        const _supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const { data: _ss } = await _supa
            .from('system_settings')
            .select('value')
            .eq('key', 'orders_enabled')
            .maybeSingle();

        if (_ss && _ss.value === 'false') {
            elLoader.style.display = 'none';
            elError.style.display  = 'none';
            elMenu.style.display   = 'none';
            // Mostrar panel de fuera de servicio
            let panelFS = document.getElementById('panel-fuera-servicio');
            if (!panelFS) {
                panelFS = document.createElement('div');
                panelFS.id = 'panel-fuera-servicio';
                Object.assign(panelFS.style, {
                    display:'flex', position:'fixed', inset:'0',
                    background:'var(--cream, #f8f5ee)',
                    flexDirection:'column', alignItems:'center',
                    justifyContent:'center', gap:'16px', zIndex:'9999',
                    fontFamily:"'DM Sans', sans-serif",
                });
                panelFS.innerHTML = `
                    <span style="font-size:64px;">🔒</span>
                    <h2 style="font-size:22px;font-weight:800;color:#2e4028;margin:0;">Sistema Fuera de Servicio</h2>
                    <p style="font-size:14px;color:#5a6b58;text-align:center;max-width:320px;line-height:1.6;margin:0;">
                        El administrador ha cerrado temporalmente el sistema de pedidos.<br>
                        Por favor vuelve más tarde o llama a un mesero.
                    </p>`;
                document.body.appendChild(panelFS);
            } else {
                panelFS.style.display = 'flex';
            }
            return; // Detener toda inicialización
        }
    } catch (_guardErr) {
        // Si la tabla no existe o hay error de red, permitir acceso (fail-open)
        console.warn('[La 26] Guard system_settings no disponible:', _guardErr?.message);
    }

    // ── 1. Capturar contexto de mesa/modalidad (sessionStorage > URL params) ──
    //    ACCESO PÚBLICO: nunca pide contraseña, solo valida ubicación del cliente.
    const sesion = capturarContexto();
    if (!sesion) return; // modal de bienvenida visible — esperando elección del cliente

    const mesaParam   = sesion.mesa;
    const nombreParam = sesion.nombre;
    modalidad         = sesion.modalidad || 'mesa'; // 'mesa' | 'para_llevar' | 'domicilio'
    tableNombre       = nombreParam || '';

    // Pre-cargar dirección de domicilio si la capturó el MesaModal
    const direccPreCargada = sessionStorage.getItem('mesa_direccion') || '';
    if (direccPreCargada && elDeliveryAddress) {
        elDeliveryAddress.value = direccPreCargada;
    }

    // ── 2. Resolver restaurant_id por slug ──────────────────────
    restaurantId = await resolverRestaurantId();
    if (!restaurantId) {
        mostrarError('No se pudo identificar el restaurante. Contacta al administrador.');
        return;
    }

    // ── 3. Resolver table_id ─────────────────────────────────────
    const esUUID = /^[0-9a-f-]{36}$/i.test(mesaParam);
    let mesa     = null;

    if (esUUID) {
        const { data } = await supabaseClient
            .from('tables')
            .select('id, number, label, restaurant_id')
            .eq('id', mesaParam)
            .eq('restaurant_id', restaurantId)
            .maybeSingle();
        mesa = data;
    } else {
        const { data } = await supabaseClient
            .from('tables')
            .select('id, number, label, restaurant_id')
            .eq('restaurant_id', restaurantId)
            .or(`number.eq.${isNaN(mesaParam) ? 0 : mesaParam},label.ilike.${mesaParam}`)
            .maybeSingle();
        mesa = data;
    }

    if (!mesa) {
        // ── Para Llevar / Domicilio: buscar o crear mesa genérica ──
        // Supabase requiere table_id NOT NULL. Usamos una fila especial
        // con label='Para Llevar' que representa todos los pedidos externos.
        if (modalidad === 'para_llevar' || modalidad === 'domicilio' ||
            mesaParam === 'domicilio' || mesaParam === 'para_llevar') {

            tableNumber = modalidad === 'domicilio' || mesaParam === 'domicilio'
                ? 'Domicilio'
                : 'Para Llevar';

            // Buscar la mesa genérica de para llevar
            const { data: mesaGenerica } = await supabaseClient
                .from('tables')
                .select('id')
                .eq('restaurant_id', restaurantId)
                .ilike('label', '%para llevar%')
                .maybeSingle();

            if (mesaGenerica?.id) {
                tableId = mesaGenerica.id;
            } else {
                // Crearla automáticamente la primera vez
                const { data: mesaNueva } = await supabaseClient
                    .from('tables')
                    .upsert([{
                        restaurant_id: restaurantId,
                        number:        0,
                        label:         'Para Llevar / Domicilio',
                        qr_code:       `VIRTUAL-TAKEAWAY-${restaurantId}`,
                        capacity:      99,
                        status:        'available',
                    }], { onConflict: 'restaurant_id,number' })
                    .select('id')
                    .single();
                tableId = mesaNueva?.id || null;
                if (tableId) console.log('[La 26] ✅ Mesa genérica "Para Llevar" creada automáticamente.');
            }

        } else {
            // Mesa física no encontrada — operar sin table_id si el esquema lo permite
            console.warn('[La 26] Mesa no encontrada en BD — operando sin table_id');
            tableId = null;

            if (mesaParam === 'barra')   tableNumber = 'Barra';
            else if (mesaParam === 'terraza') tableNumber = 'Terraza';
            else                         tableNumber = `Mesa ${mesaParam}`;
        }
    } else {
        tableId     = mesa.id;
        tableNumber = mesa.label || `Mesa ${mesa.number}`;
    }

    // ── 4. Mostrar badge de mesa y banner de bienvenida ──────────
    mostrarInfoMesa(tableNumber, tableNombre);

    // ── 5. Cargar menú del día o catálogo directo ─────────────────
    const hoy = todayISO();
    const { data: menuDia, error: errorMenuDia } = await supabaseClient
        .from('daily_menus')
        .select('id, day_type')
        .eq('restaurant_id', restaurantId)
        .eq('menu_date', hoy)
        .eq('is_published', true)
        .maybeSingle();

    if (errorMenuDia) {
        console.warn('[La 26] Error consultando daily_menus:', errorMenuDia);
    }

    if (menuDia && menuDia.id) {
        dailyMenuId = menuDia.id;
        await cargarSlotsDesdeMenuDia();
    } else {
        console.log('[La 26] Sin menú del día publicado → cargando catálogo directo');
        await cargarSlotsDesdeCatalogo();
    }
}

// ============================================================
// INICIO
// ============================================================
// No cargar la carta del cliente si estamos en modo mesero
if (!_MODO_MESERO) { cargarMenu(); }

// ─── CONSTANTE: ID de la mesa virtual para pedidos sin mesa física ────────────
// Reemplaza este valor con el UUID real que generó Supabase en el paso 1
const VIRTUAL_TABLE_ID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

// ─── FUNCIÓN: Enviar pedido a cocina ─────────────────────────────────────────
async function enviarPedidoACocina({ modalidad, mesaId, clienteNombre, direccion, notas, items }) {
  /**
   * @param {string} modalidad     - 'mesa' | 'para_llevar' | 'domicilio'
   * @param {string|null} mesaId   - UUID de la mesa física (null si no aplica)
   * @param {string} clienteNombre - Nombre del cliente
   * @param {string} direccion     - Dirección de entrega (vacía si es mesa o para llevar)
   * @param {string} notas         - Instrucciones generales del pedido
   * @param {Array}  items         - [{ menu_item_id, quantity, unit_price, notes }]
   */

  // Determinar el table_id correcto según la modalidad
  const tableId = (modalidad === 'mesa' && mesaId) ? mesaId : VIRTUAL_TABLE_ID;

  // Construir nota combinada: modalidad + dirección + notas del cliente
  const notaFinal = [
    `[${modalidad.toUpperCase().replace('_', ' ')}]`,
    modalidad === 'domicilio' && direccion ? `Dirección: ${direccion}` : null,
    notas || null,
  ].filter(Boolean).join(' | ');

  // Generar número de orden único
  const orderNumber = `ORD-${Date.now()}`;

  // 1. Insertar la orden principal
  const { data: orden, error: errorOrden } = await supabase
    .from('orders')
    .insert({
      restaurant_id: RESTAURANT_ID,   // tu constante global con el UUID del restaurante
      table_id:      tableId,          // ← nunca será null
      order_number:  orderNumber,
      status:        'pending',
      customer_name: clienteNombre || null,
      notes:         notaFinal,
      total_amount:  items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    })
    .select('id')
    .single();

  if (errorOrden) {
    console.error('Error al crear la orden:', errorOrden.message);
    throw new Error(`No se pudo enviar el pedido... ${errorOrden.message}`);
  }

  // 2. Insertar los ítems de la orden
  const orderItems = items.map(item => ({
    order_id:     orden.id,
    menu_item_id: item.menu_item_id,
    quantity:     item.quantity,
    unit_price:   item.unit_price,
    notes:        item.notes || null,
    item_status:  'pending',
  }));

  const { error: errorItems } = await supabase
    .from('order_items')
    .insert(orderItems);

  if (errorItems) {
    console.error('Error al guardar los ítems:', errorItems.message);
    throw new Error(`Orden creada pero falló al guardar los ítems: ${errorItems.message}`);
  }

  console.log(`✅ Pedido ${orderNumber} enviado a cocina — modalidad: ${modalidad}`);
  return orden.id;
}

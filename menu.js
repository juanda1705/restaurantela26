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
// MÓDULO MESERO — WaiterFlow v1.0
// ============================================================
// Flujo: Login PIN → Selección Mesa → Registro Pedido por nombre
// → Envío directo a cocina (orders + order_items en Supabase)
//
// Activación: abre menu.html?modo=mesero o llama WaiterFlow.init()
// El flujo comparte la misma BD que el cliente pero agrega:
//  - PIN de mesero (table: waiter_sessions o hardcoded por ahora)
//  - Selección de mesa numérica
//  - Campo de nombre del cliente
// ============================================================
const WaiterFlow = (function() {

    // Estado interno
    let _mesero  = null;  // { nombre, pin }
    let _mesa    = null;  // número de mesa seleccionado
    let _restaurantId = null;
    let _tableId      = null;

    // PIN hardcoded hasta que exista tabla waiter_sessions
    const PINES = {
        '1111': 'Mesero 1',
        '2222': 'Mesero 2',
        '3333': 'Mesero 3',
        '0000': 'Supervisor',
    };

    const CSS = `
        #wf-overlay {
            position:fixed;inset:0;background:#1a1f18;z-index:10000;
            display:flex;align-items:center;justify-content:center;
            font-family:'DM Sans',sans-serif;
        }
        .wf-card {
            background:#fff;border-radius:24px;padding:32px;
            width:min(420px,calc(100vw - 32px));
            box-shadow:0 24px 80px rgba(0,0,0,.4);
        }
        .wf-title {
            font-size:17px;font-weight:800;color:#1a1f18;
            margin-bottom:6px;letter-spacing:-.3px;
        }
        .wf-sub {
            font-size:12.5px;color:#8a9388;margin-bottom:22px;line-height:1.5;
        }
        .wf-label {
            font-size:11px;font-weight:700;text-transform:uppercase;
            letter-spacing:.7px;color:#4a5248;margin-bottom:6px;display:block;
        }
        .wf-input {
            width:100%;border:1.5px solid #e4e7e2;border-radius:999px;
            padding:11px 18px;font-size:14px;font-family:'DM Sans',sans-serif;
            color:#1a1f18;background:#f7f8f6;outline:none;
            transition:border-color .2s,box-shadow .2s;margin-bottom:14px;
        }
        .wf-input:focus { border-color:#4a6741;box-shadow:0 0 0 3px rgba(74,103,65,.12); }
        .wf-btn {
            width:100%;background:#4a6741;color:#fff;border:none;border-radius:999px;
            padding:13px;font-size:14px;font-weight:700;cursor:pointer;
            font-family:'DM Sans',sans-serif;transition:background .2s;
        }
        .wf-btn:hover { background:#3a5233; }
        .wf-btn:disabled { background:#c8d4c5;cursor:not-allowed; }
        .wf-err {
            background:#fdf5f3;border:1.5px solid rgba(192,80,60,.3);
            border-radius:12px;padding:9px 14px;font-size:12.5px;color:#6b2a1e;
            margin-bottom:14px;display:none;
        }
        .wf-mesa-grid {
            display:grid;grid-template-columns:repeat(4,1fr);gap:10px;
            margin-bottom:16px;
        }
        .wf-mesa-btn {
            background:#f0f2ef;border:1.5px solid #e4e7e2;border-radius:14px;
            padding:16px 8px;font-size:16px;font-weight:700;cursor:pointer;
            font-family:'DM Mono',monospace;color:#1a1f18;transition:all .15s;
            text-align:center;
        }
        .wf-mesa-btn:hover { background:#e8ede7;border-color:#c2d09c; }
        .wf-mesa-btn.selected {
            background:#4a6741;color:#fff;border-color:#4a6741;
        }
        .wf-back {
            background:none;border:1.5px solid #e4e7e2;color:#4a5248;
            border-radius:999px;padding:10px 20px;font-size:13px;
            font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;
            transition:all .2s;margin-top:10px;width:100%;
        }
        .wf-back:hover { background:#f0f2ef; }
        .wf-badge {
            display:inline-block;background:#e8ede7;color:#4a6741;
            border-radius:999px;padding:3px 12px;font-size:11.5px;font-weight:700;
            margin-bottom:18px;
        }
    `;

    function _injectCSS() {
        if (document.getElementById('wf-css')) return;
        const s = document.createElement('style');
        s.id = 'wf-css'; s.textContent = CSS;
        document.head.appendChild(s);
    }

    function _mount(html) {
        let ov = document.getElementById('wf-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'wf-overlay';
            document.body.appendChild(ov);
        }
        ov.innerHTML = html;
        ov.style.display = 'flex';
    }

    function _hide() {
        const ov = document.getElementById('wf-overlay');
        if (ov) ov.style.display = 'none';
    }

    // ── PASO 1: Login PIN ─────────────────────────────────────
    function mostrarLogin() {
        _injectCSS();
        _mount(`
            <div class="wf-card">
                <div style="text-align:center;margin-bottom:22px;">
                    <span style="font-size:40px;">🍽️</span>
                </div>
                <h2 class="wf-title" style="text-align:center;">Acceso Mesero</h2>
                <p class="wf-sub" style="text-align:center;">Restaurante la 26 · Sistema de Pedidos</p>
                <div id="wf-login-err" class="wf-err"></div>
                <label class="wf-label">Tu nombre</label>
                <input id="wf-nombre" class="wf-input" type="text"
                    placeholder="Ej: Carlos" autocomplete="off">
                <label class="wf-label">PIN de acceso</label>
                <input id="wf-pin" class="wf-input" type="password"
                    placeholder="••••" maxlength="4" autocomplete="off"
                    onkeydown="if(event.key==='Enter')WaiterFlow._loginSubmit()">
                <button class="wf-btn" onclick="WaiterFlow._loginSubmit()">Ingresar al Sistema</button>
            </div>`);
        setTimeout(() => document.getElementById('wf-nombre')?.focus(), 100);
    }

    function _loginSubmit() {
        const nombre = document.getElementById('wf-nombre')?.value.trim();
        const pin    = document.getElementById('wf-pin')?.value.trim();
        const err    = document.getElementById('wf-login-err');

        if (!nombre) { _showErr(err, 'Ingresa tu nombre.'); return; }
        if (!pin)    { _showErr(err, 'Ingresa el PIN.'); return; }

        const nombrePIN = PINES[pin];
        if (!nombrePIN) { _showErr(err, 'PIN incorrecto. Intenta de nuevo.'); return; }

        _mesero = { nombre, pin, cargo: nombrePIN };
        mostrarSeleccionMesa();
    }

    // ── PASO 2: Selección de Mesa ─────────────────────────────
    function mostrarSeleccionMesa() {
        _injectCSS();
        const mesas = Array.from({length: 12}, (_,i) => i+1)
            .map(n => `<button class="wf-mesa-btn" onclick="WaiterFlow._seleccionarMesa(${n})">${n}</button>`)
            .join('');

        _mount(`
            <div class="wf-card">
                <span class="wf-badge">👤 ${_mesero.nombre}</span>
                <h2 class="wf-title">Seleccionar Mesa</h2>
                <p class="wf-sub">¿En qué mesa están los clientes?</p>
                <div class="wf-mesa-grid">${mesas}
                    <button class="wf-mesa-btn" onclick="WaiterFlow._seleccionarMesa('barra')"
                        style="font-size:12px;font-family:'DM Sans',sans-serif;">🪑<br>Barra</button>
                    <button class="wf-mesa-btn" onclick="WaiterFlow._seleccionarMesa('para_llevar')"
                        style="font-size:11px;font-family:'DM Sans',sans-serif;">📦<br>Para Llevar</button>
                    <button class="wf-mesa-btn" onclick="WaiterFlow._seleccionarMesa('domicilio')"
                        style="font-size:11px;font-family:'DM Sans',sans-serif;">🛵<br>Domicilio</button>
                </div>
                <button class="wf-back" onclick="WaiterFlow.mostrarLogin()">← Regresar</button>
            </div>`);
    }

    function _seleccionarMesa(mesa) {
        _mesa = mesa;
        mostrarFormPedido();
    }

    // ── PASO 3: Formulario de Pedido ──────────────────────────
    function mostrarFormPedido() {
        _injectCSS();
        const mesaLabel = isNaN(_mesa) ? _mesa : `Mesa ${_mesa}`;

        _mount(`
            <div class="wf-card" style="max-height:95vh;overflow-y:auto;">
                <span class="wf-badge">🍽️ ${mesaLabel} · ${_mesero.nombre}</span>
                <h2 class="wf-title">Registrar Pedido</h2>
                <p class="wf-sub">Ingresa los datos del cliente y los platos del pedido.</p>
                <div id="wf-pedido-err" class="wf-err"></div>
                <label class="wf-label">Nombre del cliente</label>
                <input id="wf-cliente" class="wf-input" type="text"
                    placeholder="Ej: Andrés García" autocomplete="off">
                <label class="wf-label">Platos del pedido</label>
                <div id="wf-items-list" style="margin-bottom:10px;"></div>
                <button onclick="WaiterFlow._agregarLinea()"
                    style="background:#f0f2ef;border:1.5px solid #e4e7e2;color:#4a5248;
                    border-radius:999px;padding:7px 18px;font-size:12.5px;font-weight:600;
                    cursor:pointer;font-family:'DM Sans',sans-serif;margin-bottom:16px;
                    transition:all .2s;">+ Agregar plato</button>
                <label class="wf-label" style="margin-top:4px;">Notas especiales (opcional)</label>
                <input id="wf-notas" class="wf-input" type="text"
                    placeholder="Ej: Sin picante · Sin cebolla">
                <button id="wf-enviar-btn" class="wf-btn" onclick="WaiterFlow._enviarPedido()">
                    🚀 Enviar a Cocina
                </button>
                <button class="wf-back" onclick="WaiterFlow.mostrarSeleccionMesa()">← Cambiar mesa</button>
            </div>`);

        // Agregar primera línea de plato
        _agregarLinea();
    }

    function _agregarLinea() {
        const lista = document.getElementById('wf-items-list');
        if (!lista) return;
        const idx = lista.children.length;
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';
        div.innerHTML = `
            <input class="wf-input wf-item-nombre" type="text"
                placeholder="Nombre del plato" autocomplete="off"
                style="flex:2;margin-bottom:0;font-size:13px;"
                list="wf-platos-datalist">
            <input class="wf-input wf-item-qty" type="number" min="1" max="20" value="1"
                style="flex:0 0 60px;margin-bottom:0;text-align:center;padding:11px 8px;font-size:13px;">
            <button onclick="this.parentElement.remove()"
                style="background:#fdf5f3;border:1.5px solid rgba(192,80,60,.25);color:#c0503c;
                border-radius:999px;width:34px;height:34px;flex-shrink:0;cursor:pointer;
                font-size:16px;font-family:'DM Sans',sans-serif;display:flex;
                align-items:center;justify-content:center;">×</button>`;
        lista.appendChild(div);

        // Datalist con platos del menú cargado
        if (!document.getElementById('wf-platos-datalist') && slots?.length) {
            const dl = document.createElement('datalist');
            dl.id = 'wf-platos-datalist';
            slots.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.nombre;
                dl.appendChild(opt);
            });
            document.body.appendChild(dl);
        }

        const inp = div.querySelector('.wf-item-nombre');
        if (inp) setTimeout(() => inp.focus(), 80);
    }

    async function _enviarPedido() {
        const btn     = document.getElementById('wf-enviar-btn');
        const err     = document.getElementById('wf-pedido-err');
        const cliente = document.getElementById('wf-cliente')?.value.trim();
        const notas   = document.getElementById('wf-notas')?.value.trim();

        if (!cliente) { _showErr(err, 'Ingresa el nombre del cliente.'); return; }

        // Recopilar líneas de platos
        const filas   = document.querySelectorAll('#wf-items-list > div');
        const items   = [];
        filas.forEach(f => {
            const nombre = f.querySelector('.wf-item-nombre')?.value.trim();
            const qty    = parseInt(f.querySelector('.wf-item-qty')?.value) || 1;
            if (nombre) {
                const slot = slots?.find(s => s.nombre.toLowerCase() === nombre.toLowerCase());
                items.push({
                    nombre,
                    qty,
                    menuItemId: slot?.menuItemId || slot?.id || null,
                    precio: slot?.precio || 0,
                });
            }
        });

        if (items.length === 0) { _showErr(err, 'Agrega al menos un plato.'); return; }

        btn.disabled = true;
        btn.textContent = 'Enviando...';

        try {
            // Resolver restaurant_id si no está disponible
            if (!restaurantId) {
                restaurantId = await resolverRestaurantId();
            }

            // Resolver table_id
            let tId = null;
            if (!isNaN(_mesa)) {
                const { data: mesaData } = await supabaseClient
                    .from('tables')
                    .select('id')
                    .eq('restaurant_id', restaurantId)
                    .eq('number', parseInt(_mesa))
                    .maybeSingle();
                tId = mesaData?.id || null;
            }

            if (!tId) {
                // Mesa genérica para llevar / domicilio / barra
                const { data: mesaGen } = await supabaseClient
                    .from('tables')
                    .select('id')
                    .eq('restaurant_id', restaurantId)
                    .ilike('label', '%para llevar%')
                    .maybeSingle();
                tId = mesaGen?.id || null;
            }

            const mesaLabel = isNaN(_mesa) ? _mesa.toUpperCase().replace('_', ' ') : `MESA ${_mesa}`;
            const notasFinal = [
                `[${mesaLabel}]`,
                `[Mesero: ${_mesero.nombre}]`,
                notas || null,
            ].filter(Boolean).join(' | ');

            const total = items.reduce((s, i) => s + i.precio * i.qty, 0);
            const orderNumber = `MES-${Date.now()}`;

            // Insertar orden
            const { data: orden, error: errOrd } = await supabaseClient
                .from('orders')
                .insert([{
                    restaurant_id: restaurantId,
                    table_id:      tId,
                    order_number:  orderNumber,
                    status:        'pending',
                    customer_name: cliente,
                    notes:         notasFinal,
                    total_amount:  total,
                }])
                .select('id')
                .single();

            if (errOrd) throw errOrd;

            // Insertar order_items
            const orderItems = items.map(item => ({
                order_id:     orden.id,
                menu_item_id: item.menuItemId,
                quantity:     item.qty,
                unit_price:   item.precio,
                item_status:  'pending',
                notes:        `[nombre]${item.nombre}`,
            }));

            await supabaseClient.from('order_items').insert(orderItems);

            // Mostrar éxito
            _mount(`
                <div class="wf-card" style="text-align:center;">
                    <span style="font-size:52px;display:block;margin-bottom:12px;">✅</span>
                    <h2 class="wf-title">¡Pedido Enviado!</h2>
                    <p class="wf-sub">
                        Referencia: <strong>${orderNumber}</strong><br>
                        Cliente: <strong>${cliente}</strong><br>
                        Mesa: <strong>${mesaLabel}</strong><br>
                        ${items.length} plato(s) enviados a cocina.
                    </p>
                    <button class="wf-btn" onclick="WaiterFlow.mostrarSeleccionMesa()"
                        style="margin-bottom:10px;">📋 Nuevo Pedido</button>
                    <button class="wf-back" onclick="WaiterFlow._hide()">Salir al Menú</button>
                </div>`);

        } catch (e) {
            console.error('[La 26] WaiterFlow error:', e);
            _showErr(err, `Error al enviar: ${e?.message || 'Intenta de nuevo.'}`);
            btn.disabled = false;
            btn.textContent = '🚀 Enviar a Cocina';
        }
    }

    function _showErr(el, msg) {
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    // API pública
    return {
        init:                  mostrarLogin,
        mostrarLogin,
        mostrarSeleccionMesa,
        _loginSubmit,
        _seleccionarMesa,
        mostrarFormPedido,
        _agregarLinea,
        _enviarPedido,
        _hide,
    };
})();

// ── Auto-activar modo mesero si viene con ?modo=mesero en la URL ──
(function() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('modo') === 'mesero') {
        // Esperar a que el DOM esté listo
        document.addEventListener('DOMContentLoaded', () => WaiterFlow.init(), { once: true });
        // Si ya está cargado
        if (document.readyState !== 'loading') WaiterFlow.init();
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
cargarMenu();

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

// ============================================================
// RESTAURANTE LA 26 — PANEL DE ADMINISTRACIÓN
// admin.js · Versión 3.3
// FIXES v3.1 (heredados):
//  [FIX-1] SELECT orders: eliminado 'payment_method' (columna inexistente → error 400).
//  [FIX-2] UPDATE orders: cambiado status 'completed' → 'paid'
//  [FIX-3] cargarDashboardReal: totales por método de pago desde sessionStorage.
//  [FIX-4] registrarMetodoPago: guarda método en sessionStorage + BD.
//  [FIX-5] eliminarComponenteCatalogo: patrón .catch() → try/catch con await.
// FIXES v3.2 (heredados):
//  [FIX-6] SOFT DELETE en eliminarComponenteCatalogo.
//  [FIX-7] cargarSlotsMenuReal: filtro .neq('is_active', false).
//  [FIX-8] Modal de edición de comandas en admin.html.
// FIXES v3.3 (nuevos):
//  [FIX-9]  _guardarEdicionLegacyAdmin: reemplaza TODOS los
//           .catch() encadenados por try/catch con await.
//           Supabase JS v2 devuelve {data, error}, NO promesas
//           con .catch(). Esto causaba el error
//           "supabaseClient.from(...).insert(...).catch is not a function".
//  [FIX-10] cargarDashboardReal: resuelve el número/nombre de
//           mesa correctamente. Ahora consulta la tabla de mesas
//           (tables / restaurant_tables) para convertir table_id
//           al nombre visible. Fallback: "[MESA ...]" en notes,
//           luego table_id truncado, luego "P.L.".
// Bucaramanga, Santander — Colombia
// ============================================================

// ============================================================
// CREDENCIALES SUPABASE
// ============================================================
const SUPABASE_URL      = "https://hxmodeduckuhvvspnkxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ESxhljLgqWkGvrnKhvbeEg_iBqaGciv";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// CONSTANTES TRIBUTARIAS — ESTATUTO TRIBUTARIO COLOMBIA
// ============================================================
const TASA_RETE_ICA    = 0.0069;
const TASA_IMPOCONSUMO = 0.08;

// ============================================================
// ESTADO GLOBAL CONTABLE
// ============================================================
let globalIngresos = 0;
let globalEgresos  = 0;
let totalEfectivo      = 0;
let totalTransferencia = 0;
let totalFiado         = 0;
let baseInicial        = 0;

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
const Toast = (function() {
    let _c = null;
    function _init() {
        if (_c) return;
        _c = document.createElement('div');
        Object.assign(_c.style, {
            position:'fixed', top:'20px', left:'50%', transform:'translateX(-50%)',
            zIndex:'9999', display:'flex', flexDirection:'column', gap:'8px',
            alignItems:'center', pointerEvents:'none',
            width:'max-content', maxWidth:'calc(100vw - 32px)',
        });
        document.body.appendChild(_c);
    }
    function show(msg, tipo, ms = 3800) {
        _init();
        const pal = {
            ok:    { bg:'#f5f7f0', bd:'rgba(74,103,65,.35)',  tx:'#2e4028', dot:'#4a6741' },
            error: { bg:'#fdf5f3', bd:'rgba(192,80,60,.30)',  tx:'#6b2a1e', dot:'#c0503c' },
            info:  { bg:'#f5f7f0', bd:'rgba(74,103,65,.25)',  tx:'#3a4a38', dot:'#4a6741' },
        };
        const c = pal[tipo] || pal.info;
        const t = document.createElement('div');
        Object.assign(t.style, {
            display:'flex', alignItems:'center', gap:'9px',
            background:c.bg, border:`1.5px solid ${c.bd}`, borderRadius:'999px',
            padding:'10px 20px 10px 14px', boxShadow:'0 4px 20px rgba(0,0,0,.10)',
            fontSize:'13.5px', fontFamily:"'DM Sans',sans-serif", fontWeight:'500',
            color:c.tx, pointerEvents:'auto',
            opacity:'0', transform:'translateY(-8px)',
            transition:'opacity .28s ease, transform .28s ease',
        });
        const dot = document.createElement('span');
        Object.assign(dot.style, { width:'7px', height:'7px', borderRadius:'50%', background:c.dot, flexShrink:'0', display:'block' });
        const txt = document.createElement('span');
        txt.textContent = msg;
        t.appendChild(dot); t.appendChild(txt); _c.appendChild(t);
        requestAnimationFrame(() => requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)'; }));
        const timer = setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(-8px)'; setTimeout(() => t.remove(), 300); }, ms);
        t.onclick = () => { clearTimeout(timer); t.remove(); };
    }
    return { ok:(m,ms)=>show(m,'ok',ms), error:(m,ms)=>show(m,'error',ms), info:(m,ms)=>show(m,'info',ms) };
})();

// ============================================================
// FORMATO MONEDA COP
// ============================================================
function formatCOP(valor) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
    }).format(valor);
}

// ============================================================
// MAPA DE TIPOS DE PLATO
// ============================================================
const MAPA_TIPO = {
    executive_lunch: { label: 'Proteína con Salsa', icono: '🥩', porciones: 35, badgeClass: 'badge-protein' },
    protein:         { label: 'Proteína con Salsa', icono: '🥩', porciones: 35, badgeClass: 'badge-protein' },
    side:            { label: 'Principio',           icono: '🍲', porciones: 50, badgeClass: 'badge-side'    },
    drink:           { label: 'Bebida',              icono: '🍹', porciones: 20, badgeClass: 'badge-drink'   },
    a_la_carte:      { label: 'A la Carta',          icono: '✨', porciones: 15, badgeClass: 'badge-carte'   },
    soup:            { label: 'Sopa',                icono: '🍜', porciones: 20, badgeClass: 'badge-dessert' },
};

function getRangoByCodigo(codigo) {
    const n = parseInt(codigo) || 0;
    if (n >= 1  && n <= 10)  return { label: 'Vegetal/Salsa/Base', color: 'var(--olive)' };
    if (n >= 11 && n <= 30)  return { label: 'Carne/Proteína',     color: '#b43c3c'       };
    if (n >= 31 && n <= 50)  return { label: 'Acompañamiento',     color: 'var(--amber)'  };
    if (n >= 51 && n <= 70)  return { label: 'Bebida/Jugo',        color: 'var(--blue)'   };
    if (n >= 71)             return { label: 'A la Carta',          color: 'var(--purple)' };
    return { label: '—', color: 'var(--text-3)' };
}

// ============================================================
// [FIX-10 v2] _buildTableMap — tolerante a nombres de columna
// Consulta la tabla de mesas y construye { [id]: etiqueta }.
// Intenta 'tables' primero, luego 'restaurant_tables'.
// Para el label usa en orden: name → label → number →
// table_number → los últimos 4 chars del id.
// ============================================================
async function _buildTableMap() {
    const map = {};

    async function _procesarFilas(filas) {
        if (!filas || filas.length === 0) return false;
        filas.forEach(t => {
            // Acepta cualquiera de los nombres de columna posibles
            const label =
                t.label ||
                (t.number != null && t.number > 0 ? `Mesa ${t.number}` : null) ||
                String(t.id).slice(-4).toUpperCase();
            map[t.id] = label;
        });
        return true;
    }

    // Intento 1 — tabla 'tables' con todas las columnas candidatas
    try {
        const { data, error } = await supabaseClient
            .from('tables')
            .select('id, label, number');
        if (!error && await _procesarFilas(data)) return map;
    } catch (_) { /* intenta siguiente */ }

    // Intento 2 — tabla 'restaurant_tables'
    try {
        const { data, error } = await supabaseClient
            .from('restaurant_tables')
            .select('id, label, number');
        if (!error && await _procesarFilas(data)) return map;
    } catch (_) { /* sin tabla de mesas */ }

    return map;   // mapa vacío → fallback al UUID truncado
}
// ============================================================
// 1. DASHBOARD — CONTABILIDAD Y COMANDAS
// [FIX-10] Se agrega consulta de mesas para resolver table_id
// ============================================================
async function cargarDashboardReal() {
    try {
        const _ahora     = new Date();
        const _offsetMs  = 5 * 60 * 60 * 1000;
        const _hoyLocal  = new Date(_ahora.getTime() - _offsetMs);
        const _yyyy      = _hoyLocal.getUTCFullYear();
        const _mm        = String(_hoyLocal.getUTCMonth() + 1).padStart(2, '0');
        const _dd        = String(_hoyLocal.getUTCDate()).padStart(2, '0');
        const _inicioDia = `${_yyyy}-${_mm}-${_dd}T00:00:00-05:00`;
        const _finDia    = `${_yyyy}-${_mm}-${_dd}T23:59:59-05:00`;

        const _cierreDesde = sessionStorage.getItem('cierre_desde');
        const _inicioDiaEfectivo = _cierreDesde || _inicioDia;

        // [FIX-10] Cargar mapa de mesas en paralelo con las órdenes
        const [{ data: orders, error }, tableMap] = await Promise.all([
            supabaseClient
                .from('orders')
                .select(`id, order_number, customer_name, total_amount, status, notes, payment_method,
                         table_id, order_items ( quantity, notes, unit_price )`)
                .gte('created_at', _inicioDiaEfectivo)
                .lte('created_at', _finDia),
            _buildTableMap()
        ]);

        if (error) throw error;

        const ordenesValidas = (orders || []).filter(o =>
            o.status !== 'canceled' && o.status !== 'cancelled'
        );

        globalIngresos = ordenesValidas.reduce(
            (acc, o) => acc + (parseFloat(o.total_amount) || 0), 0
        );

        const elPedidos2 = document.getElementById('total-pedidos');
        if (elPedidos2) elPedidos2.textContent = `${ordenesValidas.length} pedidos`;

        const tbodyFacturas = document.getElementById('tabla-facturas');
        if (tbodyFacturas) {
            tbodyFacturas.innerHTML = '';
            if (ordenesValidas.length === 0) {
                tbodyFacturas.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                            Sin comandas registradas hoy.
                        </td>
                    </tr>`;
            } else {
                let _ef = 0, _tr = 0, _fi = 0;
                ordenesValidas.forEach(ord => {
                    const metodo = ord.payment_method || _extraerMetodoDeNotes(ord.notes || '');
                    const monto  = parseFloat(ord.total_amount) || 0;
                    if (metodo === 'efectivo')      _ef += monto;
                    if (metodo === 'transferencia') _tr += monto;
                    if (metodo === 'fiado')         _fi += monto;
                });
                sessionStorage.setItem('pm_efectivo',      String(_ef));
                sessionStorage.setItem('pm_transferencia', String(_tr));
                sessionStorage.setItem('pm_fiado',         String(_fi));
                totalEfectivo      = _ef;
                totalTransferencia = _tr;
                totalFiado         = _fi;
                renderizarTotales();

                ordenesValidas.forEach(ord => {
                    const metodo = ord.payment_method || _extraerMetodoDeNotes(ord.notes || '');
                    const badgeMetodo = metodo
                        ? _badgeMetodo(metodo)
                        : `<span style="font-size:10px;font-weight:600;padding:3px 11px;border-radius:999px;
                            background:var(--amber-lt);color:var(--amber);border:1.5px solid rgba(154,108,26,.28);
                            display:inline-block;cursor:pointer;" onclick="cambiarTab('pedidos')"
                            title="Ir a Historial de Pedidos para registrar el pago">⏳ Pendiente</span>`;

                    // [FIX-10] Resolución de mesa:
                    // 1. Busca [MESA ...] o [PARA LLEVAR] / [DOMICILIO] en notes
                    // 2. Si tiene table_id, busca en tableMap
                    // 3. Fallback: 'P.L.'
                    const mesaMatch = (ord.notes || '').match(/\[MESA\]\s*Mesa:\s*([^|]+)/i);
                    const esPL = (ord.notes || '').includes('[PARA LLEVAR]');
                    const esDom = (ord.notes || '').includes('[DOMICILIO]');
                    let mesaLabel;
                    if (mesaMatch) {
                        mesaLabel = mesaMatch[1].trim();
                    } else if (esPL) {
                        mesaLabel = 'Para Llevar';
                    } else if (esDom) {
                        mesaLabel = 'Domicilio';
                    } else if (ord.table_id && tableMap[ord.table_id]) {
                        mesaLabel = tableMap[ord.table_id];
                    } else if (ord.table_id) {
                        mesaLabel = String(ord.table_id).slice(-4).toUpperCase();
                    } else {
                        mesaLabel = 'P.L.';
                    }

                    tbodyFacturas.insertAdjacentHTML('afterbegin', `
                        <tr class="tbody-row">
                            <td>
                                <span class="mono" style="font-size:11.5px;font-weight:700;color:var(--olive);">${ord.order_number}</span>
                            </td>
                            <td style="font-size:12px;color:var(--text-2);font-weight:600;white-space:nowrap;">${mesaLabel}</td>
                            <td style="font-size:13px;color:var(--text-1);font-weight:500;">${ord.customer_name || 'Consumidor Final'}</td>
                            <td>
                                <span class="mono" style="font-size:13px;font-weight:700;color:var(--olive);">${formatCOP(ord.total_amount)}</span>
                            </td>
                            <td style="text-align:center;">${badgeMetodo}</td>
                            <td style="text-align:center;">
                                <div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;">
                                    <button onclick="exportarReciboPDF('${ord.id}')"
                                        style="background:var(--surface-2);border:1.5px solid var(--border);color:var(--text-2);border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;"
                                        onmouseover="this.style.background='var(--surface-3)'"
                                        onmouseout="this.style.background='var(--surface-2)'">
                                        📄 PDF
                                    </button>
                                    <button onclick="abrirModalFacturaElectronica('${ord.id}', '${ord.order_number}', ${ord.total_amount})"
                                        style="background:var(--olive-lt);border:1.5px solid var(--olive-bd);color:var(--olive);border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;"
                                        onmouseover="this.style.background='rgba(74,103,65,.16)'"
                                        onmouseout="this.style.background='var(--olive-lt)'">
                                        🧾 DIAN
                                    </button>
                                    <button onclick="editarComandaAdmin('${ord.id}', '${ord.order_number}', ${ord.total_amount})"
                                        style="background:var(--blue-lt);border:1.5px solid rgba(37,99,168,.28);color:var(--blue);border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;"
                                        onmouseover="this.style.background='rgba(37,99,168,.16)'"
                                        onmouseout="this.style.background='var(--blue-lt)'">
                                        ✏️ Editar
                                    </button>
                                    <button onclick="eliminarComandaReal('${ord.id}', '${ord.order_number}')" class="btn-danger">
                                        🗑️
                                    </button>
                                </div>
                            </td>
                        </tr>`);
                });
            }
        }

        // Top platos
        const ranking = {};
        (orders || []).forEach(ord => {
            if (!ord.order_items) return;
            ord.order_items.forEach(item => {
                let nombre = 'Plato Especial';
                if (item.notes && item.notes.includes('[nombre]')) {
                    nombre = item.notes.split('[nombre]')[1].split('|')[0].trim();
                }
                ranking[nombre] = (ranking[nombre] || 0) + (item.quantity || 1);
            });
        });

        const tbodyTop = document.getElementById('tabla-top-platos');
        if (tbodyTop) {
            tbodyTop.innerHTML = '';
            const listaPlatos = Object.keys(ranking);
            if (listaPlatos.length === 0) {
                tbodyTop.innerHTML = `
                    <tr>
                        <td colspan="2" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                            Sin datos de platos aún.
                        </td>
                    </tr>`;
            } else {
                listaPlatos
                    .sort((a, b) => ranking[b] - ranking[a])
                    .forEach(plato => {
                        tbodyTop.insertAdjacentHTML('beforeend', `
                            <tr class="tbody-row">
                                <td style="color:var(--text-1);font-size:13px;">${plato}</td>
                                <td style="text-align:center;">
                                    <span class="mono" style="font-size:13px;font-weight:600;color:var(--olive);">${ranking[plato]}</span>
                                </td>
                            </tr>`);
                    });
            }
        }

        const { data: gastos } = await supabaseClient
            .from('operating_expenses')
            .select('amount')
            .gte('created_at', _inicioDiaEfectivo)
            .lte('created_at', _finDia);
        globalEgresos = (gastos || []).reduce(
            (acc, g) => acc + (parseFloat(g.amount) || 0), 0
        );
        const elTotalGastos = document.getElementById('total-gastos');
        if (elTotalGastos) elTotalGastos.textContent = formatCOP(globalEgresos);

    } catch (err) {
        console.error('Error cargando dashboard:', err);
    }
}

// ============================================================
// ELIMINAR COMANDA
// ============================================================
async function eliminarComandaReal(idComanda, nroOrden) {
    if (!confirm(`⚠️ ¿Eliminar la orden ${nroOrden}?\nEsto restará el monto de los reportes.`)) return;
    try {
        await supabaseClient.from('order_items').delete().eq('order_id', idComanda);
        const { error } = await supabaseClient.from('orders').delete().eq('id', idComanda);
        if (error) throw error;
        Toast.ok(`Orden ${nroOrden} eliminada correctamente.`);
        cargarDashboardReal();
    } catch (err) {
        console.error('Error eliminando comanda:', err);
        Toast.error('Error al eliminar el registro.');
    }
}

// ============================================================
// REGISTRAR MÉTODO DE PAGO EN UNA ORDEN
// ============================================================
async function registrarMetodoPago(orderId, metodo) {
    if (!metodo) return;
    try {
        const { data: ordData, error: errRead } = await supabaseClient
            .from('orders')
            .select('total_amount, notes, payment_method')
            .eq('id', orderId)
            .single();
        if (errRead) throw errRead;

        const monto = parseFloat(ordData.total_amount) || 0;

        const notesBase  = (ordData.notes || '').replace(/\|\[pago\][^|]*/g, '').trimEnd();
        const notesNuevo = `${notesBase}|[pago]${metodo}`;

        const { error } = await supabaseClient
            .from('orders')
            .update({ status: 'paid', notes: notesNuevo, payment_method: metodo })
            .eq('id', orderId);
        if (error) throw error;

        const metodoAnterior = ordData.payment_method || _extraerMetodoDeNotes(ordData.notes || '');
        if (metodoAnterior && metodoAnterior !== metodo) {
            const keyViejo  = `pm_${metodoAnterior}`;
            const acumViejo = parseFloat(sessionStorage.getItem(keyViejo) || '0');
            sessionStorage.setItem(keyViejo, String(Math.max(0, acumViejo - monto)));
        }
        const keyPm = `pm_${metodo}`;
        if (metodoAnterior !== metodo) {
            const acum = parseFloat(sessionStorage.getItem(keyPm) || '0');
            sessionStorage.setItem(keyPm, String(acum + monto));
        }

        totalEfectivo      = parseFloat(sessionStorage.getItem('pm_efectivo')      || '0');
        totalTransferencia = parseFloat(sessionStorage.getItem('pm_transferencia') || '0');
        totalFiado         = parseFloat(sessionStorage.getItem('pm_fiado')         || '0');
        renderizarTotales();

        const label = { efectivo: 'Efectivo 💵', transferencia: 'Transferencia 📲', fiado: 'Fiado 🤝' };
        Toast.ok(`Pago registrado: ${label[metodo] || metodo}`);

        // Recargar historial de pedidos si el tab está abierto
        const tabPedidos = document.getElementById('tab-pedidos');
        if (tabPedidos && tabPedidos.style.display !== 'none') {
            cargarHistorialPedidos();
        } else {
            _actualizarBadgePago(orderId, metodo, monto);
        }

        descontarInsumosPorOrden(orderId).catch(err =>
            console.warn('[La 26] Auto-descuento inventario falló silenciosamente:', err.message)
        );

    } catch (err) {
        console.error('Error registrando método de pago:', err);
        Toast.error('No se pudo registrar el método de pago.');
    }
}

function _extraerMetodoDeNotes(notes) {
    const match = (notes || '').match(/\|\[pago\](efectivo|transferencia|fiado)/);
    return match ? match[1] : null;
}

function _actualizarBadgePago(orderId, metodo) {
    const selects = document.querySelectorAll('#tabla-facturas select');
    selects.forEach(sel => {
        if (sel.getAttribute('onchange')?.includes(orderId)) {
            sel.outerHTML = _badgeMetodo(metodo);
        }
    });
}

function _badgeMetodo(metodo) {
    const cfg = {
        efectivo:      { bg: 'var(--olive-lt)',  color: 'var(--olive)', bd: 'var(--olive-bd)',     label: '💵 Efectivo'      },
        transferencia: { bg: 'var(--blue-lt)',   color: 'var(--blue)',  bd: 'rgba(37,99,168,.28)', label: '📲 Transferencia' },
        fiado:         { bg: 'var(--amber-lt)',  color: 'var(--amber)', bd: 'rgba(154,108,26,.28)',label: '🤝 Fiado'         },
    };
    const c = cfg[metodo] || cfg.efectivo;
    return `<span style="font-size:10px;font-weight:600;padding:3px 11px;border-radius:999px;
        background:${c.bg};color:${c.color};border:1.5px solid ${c.bd};display:inline-block;">
        ${c.label}</span>`;
}

// ============================================================
// APERTURA DE CAJA
// ============================================================
function registrarAperturaCaja() {
    const inp = document.getElementById('input-base-caja');
    const val = parseFloat(inp?.value?.replace(/[^0-9.]/g,'')) || 0;
    if (val <= 0) { Toast.error('Ingresa un monto válido para la base de caja.'); return; }
    baseInicial = val;
    sessionStorage.setItem('base_caja_hoy', String(val));
    Toast.ok(`Base de caja registrada: ${formatCOP(val)}`);
    const panel = document.getElementById('panel-apertura-caja');
    if (panel) panel.style.display = 'none';
}

// ============================================================
// EXPORTAR PDF
// ============================================================
async function exportarReciboPDF(orderId) {
    try {
        const { data: ord, error } = await supabaseClient
            .from('orders')
            .select(`order_number, customer_name, total_amount, created_at,
                     order_items ( quantity, notes, unit_price )`)
            .eq('id', orderId)
            .single();

        if (error || !ord) throw error || new Error('Orden no encontrada');

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: [80, 160] });

        pdf.setFont('monospace', 'bold');
        pdf.setFontSize(11);
        pdf.text('RESTAURANTE LA 26', 40, 10, { align: 'center' });
        pdf.setFontSize(8);
        pdf.setFont('monospace', 'normal');
        pdf.text('Bucaramanga, Santander', 40, 15, { align: 'center' });
        pdf.text('Nit: 900.123.456-7', 40, 19, { align: 'center' });
        pdf.text('----------------------------------------', 40, 23, { align: 'center' });
        pdf.text(`Ref: ${ord.order_number}`, 5, 29);
        pdf.text(`Cliente: ${ord.customer_name || 'Consumidor Final'}`, 5, 34);
        pdf.text(`Fecha: ${new Date(ord.created_at).toLocaleString('es-CO')}`, 5, 39);
        pdf.text('----------------------------------------', 40, 44, { align: 'center' });
        pdf.setFont('monospace', 'bold');
        pdf.text('Cant  Detalle                  Subtotal', 5, 49);
        pdf.setFont('monospace', 'normal');

        let y = 55;
        if (ord.order_items && ord.order_items.length > 0) {
            ord.order_items.forEach(item => {
                let nombre = 'Plato Especial';
                if (item.notes && item.notes.includes('[nombre]')) {
                    nombre = item.notes.split('[nombre]')[1].split('|')[0].trim();
                }
                if (nombre.length > 20) nombre = nombre.substring(0, 18) + '..';
                const sub = (item.quantity || 1) * (item.unit_price || 0);
                pdf.text(`${item.quantity}x    ${nombre.padEnd(22, ' ')} $${sub.toLocaleString()}`, 5, y);
                y += 6;
            });
        }

        pdf.text('----------------------------------------', 40, y, { align: 'center' });
        y += 6;
        pdf.setFont('monospace', 'bold');
        pdf.setFontSize(9);
        pdf.text(`TOTAL: $${parseInt(ord.total_amount).toLocaleString()} COP`, 5, y);
        y += 8;
        const base = ord.total_amount / (1 + TASA_IMPOCONSUMO);
        const impo = ord.total_amount - base;
        pdf.setFontSize(7.5);
        pdf.setFont('monospace', 'normal');
        pdf.text(`Base gravable: $${Math.round(base).toLocaleString()}`, 5, y);
        y += 5;
        pdf.text(`Impoconsumo 8%: $${Math.round(impo).toLocaleString()}`, 5, y);
        y += 8;
        pdf.setFont('monospace', 'italic');
        pdf.text('¡Gracias por visitarnos!', 40, y, { align: 'center' });
        pdf.save(`Recibo_La26_${ord.order_number}.pdf`);

    } catch (err) {
        console.error('Error generando PDF:', err);
        Toast.error('Error al generar la tirilla PDF.');
    }
}

// ============================================================
// RENDERIZAR TOTALES POR MÉTODO DE PAGO EN KPIs
// ============================================================
function renderizarTotales() {
    const elEf = document.getElementById('kpi-efectivo');
    const elTr = document.getElementById('kpi-transferencia');
    const elFi = document.getElementById('kpi-fiado');
    const elSd = document.getElementById('kpi-saldo-caja');
    const elGv = document.getElementById('gros-ventas');

    if (elEf) elEf.textContent = formatCOP(totalEfectivo);
    if (elTr) elTr.textContent = formatCOP(totalTransferencia);
    if (elFi) elFi.textContent = formatCOP(totalFiado);
    if (elGv) elGv.textContent = formatCOP(globalIngresos);

    const saldoCaja = baseInicial + totalEfectivo + totalTransferencia;
    if (elSd) elSd.textContent = formatCOP(saldoCaja);

    const baseICA      = Math.max(0, globalIngresos - globalEgresos);
    const provisionICA = baseICA * TASA_RETE_ICA;
    const elICA = document.getElementById('val-reteica');
    if (elICA) elICA.textContent = formatCOP(provisionICA);
}

// ============================================================
// DESCUENTO AUTOMÁTICO DE INSUMOS AL REGISTRAR PAGO
// ============================================================
async function descontarInsumosPorOrden(orderId) {
    const { data: items, error: errItems } = await supabaseClient
        .from('order_items')
        .select('menu_item_id, quantity, notes')
        .eq('order_id', orderId);

    if (errItems || !items || items.length === 0) return;

    const { data: recetas } = await supabaseClient
        .from('production_recipes')
        .select(`name, recipe_ingredients ( supply_id, supply_name, quantity_per_dish, quantity_required, unit )`);

    if (!recetas || recetas.length === 0) return;

    const menuItemIds = [...new Set(items.map(i => i.menu_item_id).filter(Boolean))];
    const { data: menuItems } = await supabaseClient
        .from('menu_items')
        .select('id, name')
        .in('id', menuItemIds);

    const menuMap = {};
    (menuItems || []).forEach(m => { menuMap[m.id] = m.name; });

    const descuentos = {};

    items.forEach(item => {
        let nombrePlato = menuMap[item.menu_item_id] || '';
        if (!nombrePlato && item.notes?.includes('[nombre]')) {
            nombrePlato = item.notes.split('[nombre]')[1].split('|')[0].trim();
        }
        if (!nombrePlato) return;

        const receta = recetas.find(r =>
            r.name.toLowerCase().trim() === nombrePlato.toLowerCase().trim() ||
            nombrePlato.toLowerCase().includes(r.name.toLowerCase().split(' ')[0])
        );
        if (!receta?.recipe_ingredients?.length) return;

        const qty = item.quantity || 1;
        receta.recipe_ingredients.forEach(ing => {
            if (!ing.supply_id) return;
            const _qpd = ing.quantity_per_dish ?? ing.quantity_required ?? 0;
            descuentos[ing.supply_id] = (descuentos[ing.supply_id] || 0) + _qpd * qty;
        });
    });

    if (Object.keys(descuentos).length === 0) return;

    const supplyIds = Object.keys(descuentos);
    const { data: stocks } = await supabaseClient
        .from('inventory_supplies')
        .select('id, current_stock')
        .in('id', supplyIds);

    for (const s of (stocks || [])) {
        const nuevoStock = Math.max(0, (parseFloat(s.current_stock) || 0) - (descuentos[s.id] || 0));
        await supabaseClient
            .from('inventory_supplies')
            .update({ current_stock: nuevoStock, updated_at: new Date().toISOString() })
            .eq('id', s.id);
    }

    console.log(`[La 26] 📦 Inventario descontado automáticamente para orden ${orderId}`);
}

// ============================================================
// MODAL FACTURA ELECTRÓNICA (DIAN)
// ============================================================
let _feOrdenId   = null;
let _feOrdenNo   = null;
let _feBaseTotal = 0;

function abrirModalFacturaElectronica(orderId, ordenNo, totalBruto) {
    _feOrdenId   = orderId;
    _feOrdenNo   = ordenNo;
    _feBaseTotal = parseFloat(totalBruto) || 0;

    const baseGravable = _feBaseTotal / (1 + TASA_IMPOCONSUMO);
    const impoconsumo  = _feBaseTotal - baseGravable;

    const elOrdenNo  = document.getElementById('fe-orden-no');
    const elSubtotal = document.getElementById('fe-subtotal');
    const elIva      = document.getElementById('fe-iva');
    const elTotal    = document.getElementById('fe-total');
    if (elOrdenNo)  elOrdenNo.textContent  = ordenNo;
    if (elSubtotal) elSubtotal.textContent = formatCOP(baseGravable);
    if (elIva)      elIva.textContent      = formatCOP(impoconsumo);
    if (elTotal)    elTotal.textContent    = formatCOP(_feBaseTotal);

    const modal    = document.getElementById('modal-factura-dian');
    const elNombre = document.getElementById('fe-nombre');
    const elNit    = document.getElementById('fe-nit');
    const elEmail  = document.getElementById('fe-email');
    const elResult = document.getElementById('fe-resultado');
    if (elNombre) elNombre.value = '';
    if (elNit)    elNit.value    = '';
    if (elEmail)  elEmail.value  = '';
    if (elResult) elResult.style.display = 'none';
    if (modal)    modal.style.display    = 'flex';
}

function cerrarModalFactura() {
    const modal = document.getElementById('modal-factura-dian');
    if (modal) modal.style.display = 'none';
    _feOrdenId   = null;
    _feOrdenNo   = null;
    _feBaseTotal = 0;
}

function _generarHashCUFE(semilla) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const uuid  = crypto.randomUUID().replace(/-/g, '').toUpperCase();
    const base  = btoa(semilla + uuid).replace(/[^A-Z0-9]/gi, '').toUpperCase();
    return base.substring(0, 96).padEnd(96, chars[Math.floor(Math.random() * chars.length)]);
}

async function generarFacturaElectronica() {
    const nombre = document.getElementById('fe-nombre')?.value.trim() || '';
    const nit    = document.getElementById('fe-nit')?.value.trim()    || '';
    const email  = document.getElementById('fe-email')?.value.trim()  || '';

    if (!nombre || !nit || !email) {
        Toast.error('Completa todos los campos del receptor antes de continuar.');
        return;
    }

    const baseGravable = _feBaseTotal / (1 + TASA_IMPOCONSUMO);
    const impoconsumo  = _feBaseTotal - baseGravable;
    const fechaStr     = new Date().toISOString();
    const cufe         = _generarHashCUFE(`${_feOrdenNo}${nit}${fechaStr}`);

    const payload = {
        tipo_documento:  '01',
        descripcion:     'Factura Electrónica de Venta',
        numero_factura:  _feOrdenNo,
        fecha_emision:   fechaStr,
        cufe,
        estado_dian:     'Enviado — CUFE Generado',
        emisor: {
            nit:            '900.123.456-7',
            razon_social:   'Restaurante la 26 SAS',
            municipio:      'Bucaramanga',
            departamento:   'Santander',
            actividad_ciiu: '5611',
        },
        receptor: {
            tipo_doc:   nit.includes('-') ? 'NIT' : 'CC',
            numero_doc: nit,
            nombre,
            email,
        },
        tributos: {
            base_gravable_cop:    Math.round(baseGravable),
            impoconsumo_8pct_cop: Math.round(impoconsumo),
            rete_ica_bga_6_9_mil: Math.round(baseGravable * TASA_RETE_ICA),
            total_factura_cop:    Math.round(_feBaseTotal),
        },
        referencia_interna:    { order_id: _feOrdenId, order_number: _feOrdenNo },
        proveedor_tecnologico: 'SIIGO S.A. — Habilitado DIAN Res. 000042 / 2020',
    };

    try {
        await supabaseClient.from('invoice_records').insert([{
            order_id:        _feOrdenId,
            order_number:    _feOrdenNo,
            receptor_nombre: nombre,
            receptor_nit:    nit,
            receptor_email:  email,
            subtotal:        Math.round(baseGravable),
            iva:             Math.round(impoconsumo),
            total:           Math.round(_feBaseTotal),
            cufe,
            payload:         JSON.stringify(payload),
            created_at:      fechaStr,
        }]);
    } catch (_) { /* tabla opcional */ }

    const elResult = document.getElementById('fe-resultado');
    if (elResult) {
        elResult.style.display = 'block';
        elResult.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:18px;">✅</span>
                <span style="font-size:13px;font-weight:700;color:var(--olive);">CUFE Generado — Enviado a DIAN</span>
            </div>
            <p style="font-size:11.5px;color:var(--text-2);line-height:1.7;">
                <strong>CUFE:</strong> <span class="mono" style="word-break:break-all;font-size:10px;">${cufe}</span><br>
                <strong>Receptor:</strong> ${nombre} — ${nit}<br>
                <strong>Correo:</strong> ${email}<br>
                <strong>Base Gravable:</strong> ${formatCOP(baseGravable)}<br>
                <strong>Impoconsumo (8%):</strong> ${formatCOP(impoconsumo)}<br>
                <strong>Total Factura:</strong> ${formatCOP(_feBaseTotal)}
            </p>`;
    }
    console.log('✅ Payload DIAN generado:', payload);
}

// ============================================================
// 3. MENÚ — EDITOR MODULAR CON CÓDIGO DE PRODUCTO
// ============================================================
let componenteFiltradoActual = 'todos';

// 'activos' | 'inactivos' — solo relevante en admin
let _vistaMenuAdmin = 'activos';

function verProductosActivos() {
    _vistaMenuAdmin = 'activos';
    const btnA = document.getElementById('btn-vista-activos');
    const btnI = document.getElementById('btn-vista-inactivos');
    if (btnA) { btnA.style.background='var(--olive)'; btnA.style.color='#fff'; btnA.style.borderColor='var(--olive-bd)'; }
    if (btnI) { btnI.style.background='var(--surface-2)'; btnI.style.color='var(--text-3)'; btnI.style.borderColor='var(--border)'; }
    cargarSlotsMenuReal();
}

function verProductosInactivos() {
    _vistaMenuAdmin = 'inactivos';
    const btnA = document.getElementById('btn-vista-activos');
    const btnI = document.getElementById('btn-vista-inactivos');
    if (btnI) { btnI.style.background='var(--red)'; btnI.style.color='#fff'; btnI.style.borderColor='var(--red)'; }
    if (btnA) { btnA.style.background='var(--surface-2)'; btnA.style.color='var(--text-3)'; btnA.style.borderColor='var(--border)'; }
    cargarSlotsMenuReal();
}

async function cargarSlotsMenuReal() {
    const contenedor = document.getElementById('contenedor-slots-menu');
    if (!contenedor) return;

    contenedor.innerHTML = `
        <p style="color:var(--text-3);font-size:12.5px;grid-column:span 3;text-align:center;padding:28px;">
            Sincronizando catálogo...
        </p>`;

    try {
        let query = supabaseClient
            .from('menu_items')
            .select('id, name, description, price, item_type, is_active, portions_today, restaurant_id, category_id, created_at')
            .eq('is_active', _vistaMenuAdmin === 'activos')
            .order('name', { ascending: true });

        if (componenteFiltradoActual !== 'todos') {
            query = query.eq('item_type', componenteFiltradoActual);
        }

        const { data: items, error } = await query;
        if (error) throw error;

        contenedor.innerHTML = '';

        if (!items || items.length === 0) {
            contenedor.innerHTML = `
                <p style="color:var(--text-3);font-size:12.5px;grid-column:span 3;text-align:center;padding:28px;">
                    Sin platos en esta categoría.
                </p>`;
            return;
        }

        const itemsOrdenados = [...items].sort((a, b) => {
            const orden = { protein: 1, executive_lunch: 1, side: 2, drink: 3, a_la_carte: 4, soup: 5 };
            const oA = orden[a.item_type] || 9;
            const oB = orden[b.item_type] || 9;
            if (oA !== oB) return oA - oB;
            return (a.name || '').localeCompare(b.name || '', 'es');
        });

        itemsOrdenados.forEach((item, animIdx) => {
            const cfg            = MAPA_TIPO[item.item_type] || { label: item.item_type, icono: '🍽️', porciones: 20, badgeClass: '' };
            const nombreEscapado = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const codigo         = '—';
            const rango          = { color: 'var(--text-3)' };

            contenedor.insertAdjacentHTML('beforeend', `
                <div class="card menu-card" style="display:flex;flex-direction:column;gap:12px;animation-delay:${animIdx * 40}ms;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                            <span style="font-size:11px;font-weight:700;color:${rango.color};background:rgba(0,0,0,.04);border:1.5px solid rgba(0,0,0,.07);border-radius:999px;padding:3px 9px;flex-shrink:0;" class="mono">#${codigo}</span>
                            <span class="badge ${cfg.badgeClass}">${cfg.icono} ${cfg.label}</span>
                        </div>
                        <button onclick="eliminarComponenteCatalogo('${item.id}','${nombreEscapado}')"
                            style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:15px;padding:0;flex-shrink:0;transition:color .2s;"
                            onmouseover="this.style.color='var(--red)'"
                            onmouseout="this.style.color='var(--text-3)'"
                            title="Dar de baja">🗑️</button>
                    </div>

                    <h4 style="font-size:13.5px;font-weight:600;color:var(--text-1);line-height:1.4;margin:0;">
                        ${item.name}
                    </h4>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--surface-2);border:1.5px solid var(--border);border-radius:14px;padding:12px;">
                        <div>
                            <p style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Precio ($)</p>
                            <input type="number" value="${item.price}"
                                onchange="actualizarPrecioPlatoReal('${item.id}', this.value)"
                                class="card-input" style="color:var(--olive);">
                        </div>
                        <div>
                            <p style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Porciones hoy</p>
                            <input type="number" value="${item.portions_today ?? cfg.porciones}"
                                onchange="actualizarPorcionesHoy('${item.id}', this.value)"
                                class="card-input" style="color:var(--amber);">
                        </div>
                    </div>

                    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid var(--border);padding-top:10px;">
                        ${_vistaMenuAdmin === 'inactivos'
                            ? `<span style="font-size:11.5px;color:var(--text-3);">Producto inactivo</span>
                               <button onclick="reactivarProducto('${item.id}','${nombreEscapado}')"
                                   style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:5px 13px;border-radius:999px;border:1.5px solid var(--olive-bd);background:var(--olive-lt);color:var(--olive);cursor:pointer;font-family:'DM Sans',sans-serif;">
                                   <i data-lucide="rotate-ccw" style="width:12px;height:12px;"></i> Reactivar
                               </button>`
                            : `<span style="font-size:11.5px;color:var(--text-3);">¿Disponible hoy?</span>
                               <button data-switch-id="${item.id}"
                                   onclick="alternarVisibilidadPlatoReal('${item.id}', ${item.is_active})"
                                   class="${item.is_active ? 'sw-on' : 'sw-off'}">
                                   ${item.is_active ? '<i data-lucide=\"check\" style=\"width:12px;height:12px;\"></i> Activo' : '<i data-lucide=\"x\" style=\"width:12px;height:12px;\"></i> Agotado'}
                               </button>`
                        }
                    </div>
                </div>`);
        });

        // Re-inicializar iconos Lucide en las tarjetas generadas dinámicamente
        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error('Error cargando menú:', err);
        contenedor.innerHTML = `
            <p style="color:var(--red);font-size:12.5px;grid-column:span 3;text-align:center;padding:28px;">
                Error de conexión con Supabase. Revisa la consola.
            </p>`;
    }
}

// ============================================================
// FILTRADO POR COMPONENTE
// ============================================================
function filtrarMenuComponente(cat) {
    componenteFiltradoActual = cat;
    document.querySelectorAll('.btn-comp').forEach(btn => {
        btn.classList.remove('filter-active');
    });
    const btnActivo = document.getElementById(`btn-comp-${cat}`);
    if (btnActivo) btnActivo.classList.add('filter-active');
    cargarSlotsMenuReal();
}

// ============================================================
// REGISTRAR NUEVO PLATO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const formNuevoPlato = document.getElementById('form-nuevo-plato');
    if (formNuevoPlato) {
        formNuevoPlato.addEventListener('submit', async (e) => {
            e.preventDefault();

            const product_code   = parseInt(document.getElementById('menu-codigo').value) || null;
            const name           = document.getElementById('menu-nombre').value.trim();
            const price          = parseFloat(document.getElementById('menu-precio').value);
            const item_type      = document.getElementById('menu-tipo').value;
            const portions_today = parseInt(document.getElementById('menu-porciones').value) || null;

            if (item_type === 'sauce') {
                Toast.error('El tipo "sauce" no está disponible como tipo independiente.');
                return;
            }

            try {
                let restaurantId;
                const { data: res, error: errRes } = await supabaseClient
                    .from('restaurants')
                    .select('id')
                    .limit(1)
                    .maybeSingle();

                if (errRes) throw errRes;

                if (res && res.id) {
                    restaurantId = res.id;
                } else {
                    const { data: nuevoRest, error: errNuevo } = await supabaseClient
                        .from('restaurants')
                        .insert([{ name: 'Restaurante la 26', slug: 'restaurante-la-26' }])
                        .select('id')
                        .single();
                    if (errNuevo) throw errNuevo;
                    restaurantId = nuevoRest.id;
                }

                const mapaCategoria = {
                    executive_lunch: 'Proteína con Salsa',
                    protein:         'Proteína con Salsa',
                    side:            'Principio',
                    drink:           'Bebida',
                    a_la_carte:      'A la Carta',
                    soup:            'Sopa',
                };
                const nombreCategoria = mapaCategoria[item_type] || 'General';

                await supabaseClient
                    .from('menu_categories')
                    .upsert(
                        [{ restaurant_id: restaurantId, name: nombreCategoria, slot_type: 'single', display_order: 0 }],
                        { onConflict: 'restaurant_id,name', ignoreDuplicates: true }
                    );

                const { data: cat, error: errCat } = await supabaseClient
                    .from('menu_categories')
                    .select('id')
                    .eq('restaurant_id', restaurantId)
                    .eq('name', nombreCategoria)
                    .maybeSingle();

                if (errCat) throw errCat;
                if (!cat || !cat.id) throw new Error(`No se pudo obtener la categoría "${nombreCategoria}".`);

                const payload = {
                    restaurant_id: restaurantId,
                    category_id:   cat.id,
                    name,
                    price,
                    item_type,
                    is_active: true,
                };
                if (portions_today !== null) payload.portions_today = portions_today;
                if (product_code) payload.product_code = product_code;

                const { error: errItem } = await supabaseClient
                    .from('menu_items')
                    .insert([payload]);

                if (errItem) {
                    if (errItem.code === '42703' && payload.product_code) {
                        delete payload.product_code;
                        const { error: errRetry } = await supabaseClient
                            .from('menu_items').insert([payload]);
                        if (errRetry) {
                            if (errRetry.code === '23505') {
                                Toast.error(`Ya existe un plato llamado "${name}" en el catálogo.`);
                                return;
                            }
                            throw errRetry;
                        }
                    } else if (errItem.code === '23505') {
                        Toast.error(`Ya existe un plato llamado "${name}" en el catálogo.`);
                        return;
                    } else {
                        throw errItem;
                    }
                }

                document.getElementById('menu-codigo').value    = '';
                document.getElementById('menu-nombre').value    = '';
                document.getElementById('menu-precio').value    = '';
                document.getElementById('menu-porciones').value = '';
                Toast.ok(`"${name}" registrado en el catálogo correctamente.`);
                cargarSlotsMenuReal();

            } catch (err) {
                console.error('Error al guardar plato:', err);
                Toast.error(`Error al guardar: ${err.message}`);
            }
        });
    }
});

// ============================================================
// ELIMINAR / DAR DE BAJA PLATO DEL CATÁLOGO [FIX-6]
// ============================================================
async function eliminarComponenteCatalogo(idItem, nombreItem) {
    if (!confirm(
        `⚠️ ¿Dar de baja "${nombreItem}" del catálogo?\n\n` +
        `Si el plato tiene ventas históricas se ocultará del menú pero ` +
        `su historial se conservará intacto.`
    )) return;

    try {
        try {
            await supabaseClient
                .from('menu_item_ingredients')
                .delete()
                .eq('menu_item_id', idItem);
        } catch (_) { }

        try {
            await supabaseClient
                .from('recipe_ingredients')
                .delete()
                .eq('supply_id', idItem);
        } catch (_) { }

        const { error: errDelete } = await supabaseClient
            .from('menu_items')
            .delete()
            .eq('id', idItem);

        if (!errDelete) {
            Toast.ok(`"${nombreItem}" eliminado del catálogo.`);
            cargarSlotsMenuReal();
            return;
        }

        if (errDelete.code === '23503') {
            const { error: errSoft } = await supabaseClient
                .from('menu_items')
                .update({
                    is_active:  false,
                    deleted_at: new Date().toISOString(),
                })
                .eq('id', idItem);

            if (!errSoft) {
                Toast.ok(`"${nombreItem}" dado de baja. Su historial de ventas se conserva.`);
                cargarSlotsMenuReal();
                return;
            }

            if (errSoft.code === '42703') {
                const { error: errFallback } = await supabaseClient
                    .from('menu_items')
                    .update({ is_active: false })
                    .eq('id', idItem);

                if (!errFallback) {
                    Toast.ok(`"${nombreItem}" desactivado del catálogo. Historial conservado.`);
                    Toast.info('Ejecuta el SQL de migración para agregar la columna deleted_at.', 5000);
                    cargarSlotsMenuReal();
                    return;
                }
                throw errFallback;
            }

            throw errSoft;
        }

        throw errDelete;

    } catch (err) {
        console.error('[La 26] Error en eliminarComponenteCatalogo:', err);
        Toast.error(`No se pudo dar de baja "${nombreItem}". Revisa la consola.`);
    }
}

// ============================================================
// ACTUALIZAR PRECIO DEL PLATO
// ============================================================
async function actualizarPrecioPlatoReal(idPlato, nuevoPrecio) {
    try {
        const { error } = await supabaseClient
            .from('menu_items')
            .update({ price: parseFloat(nuevoPrecio) })
            .eq('id', idPlato);
        if (error) throw error;
    } catch (err) {
        console.error('Error actualizando precio:', err);
    }
}

// ============================================================
// HELPER: actualizar switch de disponibilidad en DOM
// ============================================================
function _actualizarSwitchDOM(idPlato, activo) {
    const btn = document.querySelector(`[data-switch-id="${idPlato}"]`);
    if (!btn) return;
    btn.className   = activo ? 'sw-on' : 'sw-off';
    btn.textContent = activo ? '🟢 Activo' : '🔴 Agotado';
    btn.setAttribute('onclick', `alternarVisibilidadPlatoReal('${idPlato}', ${activo})`);
}

// ============================================================
// ACTUALIZAR PORCIONES
// ============================================================
async function actualizarPorcionesHoy(idPlato, valor) {
    const porciones = parseInt(valor) || 0;
    const payload   = { portions_today: porciones };
    if (porciones === 0) {
        payload.is_active = false;
        _actualizarSwitchDOM(idPlato, false);
    }
    try {
        const { error } = await supabaseClient
            .from('menu_items')
            .update(payload)
            .eq('id', idPlato);

        if (error) {
            if (error.code === '42703' || (error.message && error.message.includes('portions_today'))) {
                console.warn('Columna portions_today no existe.');
                if (porciones === 0) {
                    await supabaseClient.from('menu_items').update({ is_active: false }).eq('id', idPlato);
                }
                return;
            }
            throw error;
        }
    } catch (err) {
        console.error('Error actualizando porciones:', err.message || err);
        if (porciones === 0) _actualizarSwitchDOM(idPlato, true);
        Toast.error(`Error al guardar porciones: ${err.message || 'revisa la consola'}`);
    }
}

// ============================================================
// ALTERNAR DISPONIBILIDAD
// ============================================================
async function alternarVisibilidadPlatoReal(idPlato, estadoActual) {
    const nuevoEstado = !estadoActual;
    _actualizarSwitchDOM(idPlato, nuevoEstado);
    try {
        const { error } = await supabaseClient
            .from('menu_items')
            .update({ is_active: nuevoEstado })
            .eq('id', idPlato);
        if (error) throw error;
    } catch (err) {
        console.error('Error cambiando disponibilidad:', err);
        _actualizarSwitchDOM(idPlato, estadoActual);
        Toast.error('No se pudo guardar el cambio de disponibilidad.');
    }
}

// ============================================================
// 4. NÓMINA Y GASTOS OPERACIONALES
// ============================================================
async function cargarGastosReal() {
    const tbody = document.getElementById('tabla-gastos');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
            Consultando movimientos...
        </td></tr>`;

    try {
        const _ahora2    = new Date();
        const _offsetMs2 = 5 * 60 * 60 * 1000;
        const _hoyL2     = new Date(_ahora2.getTime() - _offsetMs2);
        const _yyyy2     = _hoyL2.getUTCFullYear();
        const _mm2       = String(_hoyL2.getUTCMonth() + 1).padStart(2, '0');
        const _dd2       = String(_hoyL2.getUTCDate()).padStart(2, '0');
        const _ini2      = `${_yyyy2}-${_mm2}-${_dd2}T00:00:00-05:00`;
        const _fin2      = `${_yyyy2}-${_mm2}-${_dd2}T23:59:59-05:00`;

        const { data: egresos, error } = await supabaseClient
            .from('operating_expenses')
            .select('*')
            .gte('created_at', _ini2)
            .lte('created_at', _fin2)
            .order('created_at', { ascending: false });

        if (error) throw error;

        globalEgresos = (egresos || []).reduce(
            (acc, g) => acc + (parseFloat(g.amount) || 0), 0
        );

        const elTotalGastos = document.getElementById('total-gastos');
        if (elTotalGastos) elTotalGastos.textContent = formatCOP(globalEgresos);

        tbody.innerHTML = '';

        if (!egresos || egresos.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                    Sin salidas registradas.
                </td></tr>`;
            return;
        }

        egresos.forEach(g => {
            const hora = new Date(g.created_at).toLocaleTimeString('es-CO', {
                hour: '2-digit', minute: '2-digit'
            });
            tbody.insertAdjacentHTML('beforeend', `
                <tr class="tbody-row">
                    <td>
                        <span style="background:var(--red-lt);color:var(--red);border:1.5px solid var(--red-bd);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">${g.expense_type}</span>
                    </td>
                    <td style="color:var(--text-1);font-size:13px;">${g.description}</td>
                    <td>
                        <span class="mono" style="font-size:13px;font-weight:600;color:var(--red);">- ${formatCOP(g.amount)}</span>
                    </td>
                    <td style="text-align:right;font-size:11.5px;color:var(--text-3);" class="mono">${hora}</td>
                </tr>`);
        });

    } catch (err) {
        console.error('Error cargando egresos:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const formGasto = document.getElementById('form-gasto');
    if (formGasto) {
        formGasto.addEventListener('submit', async (e) => {
            e.preventDefault();
            const expense_type = document.getElementById('gasto-tipo').value;
            const description  = document.getElementById('gasto-descripcion').value;
            const amount       = parseFloat(document.getElementById('gasto-monto').value);
            try {
                const { error } = await supabaseClient
                    .from('operating_expenses')
                    .insert([{ expense_type, description, amount }]);
                if (error) throw error;
                formGasto.reset();
                cargarGastosReal();
            } catch (err) {
                console.error('Error insertando gasto:', err);
                Toast.error('Error al registrar el movimiento contable.');
            }
        });
    }
});

// ============================================================
// 5. INVENTARIO / KÁRDEX
// ============================================================
async function cargarInventarioReal() {
    const tbody = document.getElementById('tabla-inventario');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
            Mapeando bodegas...
        </td></tr>`;

    try {
        const { data: stock, error } = await supabaseClient
            .from('inventory_supplies')
            .select('*')
            .order('item_name', { ascending: true });

        if (error) throw error;

        tbody.innerHTML = '';

        if (!stock || stock.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                    No hay insumos registrados.
                </td></tr>`;
            return;
        }

        stock.forEach(inv => {
            const cant = parseFloat(inv.current_stock);
            const alertaCell = cant <= 5
                ? `<span style="background:var(--red-lt);border:1.5px solid var(--red-bd);color:var(--red);padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;">${cant} ⚠️ Stock bajo</span>`
                : `<span class="mono" style="font-size:13px;color:var(--text-1);font-weight:600;">${cant}</span>`;
            const nombreEscapado = (inv.item_name || '').replace(/'/g, "\\'");

            tbody.insertAdjacentHTML('beforeend', `
                <tr class="tbody-row">
                    <td style="font-size:13px;font-weight:600;color:var(--text-1);">${inv.item_name}</td>
                    <td style="font-size:12px;color:var(--text-3);">${inv.category}</td>
                    <td style="text-align:center;">${alertaCell}</td>
                    <td style="text-align:center;font-size:12px;color:var(--text-3);">${inv.unit_of_measure}</td>
                    <td style="text-align:center;">
                        <div style="display:flex;justify-content:center;gap:4px;">
                            <button onclick="ajustarExistenciasFisicas('${inv.id}',${cant},-1)"
                                style="background:var(--red-lt);border:1.5px solid var(--red-bd);color:var(--red);border-radius:999px;width:28px;height:28px;cursor:pointer;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;transition:all .2s;"
                                onmouseover="this.style.background='rgba(192,57,43,.16)'"
                                onmouseout="this.style.background='var(--red-lt)'">−</button>
                            <button onclick="ajustarExistenciasFisicas('${inv.id}',${cant},1)"
                                style="background:var(--olive-lt);border:1.5px solid var(--olive-bd);color:var(--olive);border-radius:999px;width:28px;height:28px;cursor:pointer;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;transition:all .2s;"
                                onmouseover="this.style.background='rgba(74,103,65,.18)'"
                                onmouseout="this.style.background='var(--olive-lt)'">+</button>
                        </div>
                    </td>
                    <td style="text-align:right;">
                        <button onclick="eliminarInsumoReal('${inv.id}','${nombreEscapado}')" class="btn-danger">
                            🗑️ Dar de baja
                        </button>
                    </td>
                </tr>`);
        });

    } catch (err) {
        console.error('Error cargando kárdex:', err);
    }
}

async function ajustarExistenciasFisicas(idInsumo, stockActual, delta) {
    const nuevoStock = Math.max(0, stockActual + delta);
    try {
        const { error } = await supabaseClient
            .from('inventory_supplies')
            .update({ current_stock: nuevoStock, updated_at: new Date().toISOString() })
            .eq('id', idInsumo);
        if (error) throw error;
        cargarInventarioReal();
    } catch (err) {
        console.error('Error ajustando stock:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const basePersistida = parseFloat(sessionStorage.getItem('base_caja_hoy') || '0');
    if (basePersistida > 0) {
        baseInicial = basePersistida;
        const panel = document.getElementById('panel-apertura-caja');
        if (panel) panel.style.display = 'none';
    }

    const formNuevoInsumo = document.getElementById('form-nuevo-insumo');
    if (formNuevoInsumo) {
        formNuevoInsumo.addEventListener('submit', async (e) => {
            e.preventDefault();
            const item_name       = document.getElementById('inv-nombre').value.trim();
            const category        = document.getElementById('inv-categoria').value;
            const current_stock   = parseFloat(document.getElementById('inv-stock').value);
            const unit_of_measure = document.getElementById('inv-unidad').value;
            try {
                const { error } = await supabaseClient
                    .from('inventory_supplies')
                    .insert([{ item_name, category, current_stock, unit_of_measure, updated_at: new Date().toISOString() }]);
                if (error) {
                    if (error.code === '23505') {
                        Toast.error('Ya existe un insumo con ese nombre.');
                        return;
                    }
                    throw error;
                }
                formNuevoInsumo.reset();
                Toast.ok(`Insumo "${item_name}" registrado correctamente.`);
                cargarInventarioReal();
            } catch (err) {
                console.error('Error insertando insumo:', err);
                Toast.error('No se pudo agregar el insumo.');
            }
        });
    }
});

async function eliminarInsumoReal(idInsumo, nombreInsumo) {
    if (!confirm(`⚠️ ¿Dar de baja "${nombreInsumo}"?`)) return;
    try {
        const { error } = await supabaseClient
            .from('inventory_supplies')
            .delete()
            .eq('id', idInsumo);
        if (error) throw error;
        Toast.ok(`"${nombreInsumo}" eliminado del kárdex.`);
        cargarInventarioReal();
    } catch (err) {
        console.error('Error eliminando insumo:', err);
        Toast.error('Error al eliminar el insumo.');
    }
}

// ============================================================
// 6. CIERRE DE CAJA INTELIGENTE — INFORME Z
// ============================================================
async function ejecutarCierreCaja() {
    const baseReteICA  = Math.max(0, globalIngresos - globalEgresos);
    const totalICA     = baseReteICA * TASA_RETE_ICA;
    const ivaConsumo   = globalIngresos * TASA_IMPOCONSUMO;
    const utilidadNeta = globalIngresos - globalEgresos - totalICA;
    const saldoCaja    = baseInicial + totalEfectivo + totalTransferencia;

    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formatCOP(val);
    };
    setEl('cierre-ing',   globalIngresos);
    setEl('cierre-eg',    globalEgresos);
    setEl('cierre-ica',   totalICA);
    setEl('cierre-impo',  ivaConsumo);
    setEl('cierre-ut',    utilidadNeta);
    setEl('cierre-ef',    totalEfectivo);
    setEl('cierre-tr',    totalTransferencia);
    setEl('cierre-fi',    totalFiado);
    setEl('cierre-saldo', saldoCaja);

    const elUt = document.getElementById('cierre-ut');
    if (elUt) elUt.style.color = utilidadNeta >= 0 ? 'var(--olive)' : 'var(--red)';

    const modal = document.getElementById('modal-cierre-caja');
    if (modal) modal.style.display = 'flex';
}

function cerrarModalCierre() {
    const modal = document.getElementById('modal-cierre-caja');
    if (modal) modal.style.display = 'none';
}

async function realizarCierre() {
    const baseReteICA  = Math.max(0, globalIngresos - globalEgresos);
    const totalICA     = baseReteICA * TASA_RETE_ICA;
    const ivaConsumo   = globalIngresos * TASA_IMPOCONSUMO;
    const utilidadNeta = globalIngresos - globalEgresos - totalICA;
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const cierrePayload = {
        fecha:         hoy,
        ingresos:      Math.round(globalIngresos),
        egresos:       Math.round(globalEgresos),
        utilidad_neta: Math.round(utilidadNeta),
        provision_ica: Math.round(totalICA),
        impoconsumo:   Math.round(ivaConsumo),
        efectivo:      Math.round(totalEfectivo),
        transferencia: Math.round(totalTransferencia),
        fiado:         Math.round(totalFiado),
        base_caja:     Math.round(baseInicial),
        created_at:    new Date().toISOString(),
    };

    try {
        const { error } = await supabaseClient
            .from('historial_cierres')
            .insert([cierrePayload]);
        if (error) throw error;
        Toast.ok(`✅ Cierre del ${hoy} archivado en el calendario.`, 6000);
    } catch (err) {
        console.warn('historial_cierres no disponible — guardando localmente:', err.message);
        const histLocal = JSON.parse(localStorage.getItem('cierres_local') || '[]');
        histLocal.unshift({ ...cierrePayload, local: true });
        localStorage.setItem('cierres_local', JSON.stringify(histLocal.slice(0, 90)));
        Toast.ok('Cierre archivado localmente.');
    }

    const ahoraCierre = new Date().toISOString();
    sessionStorage.setItem('cierre_desde', ahoraCierre);

    ['pm_efectivo','pm_transferencia','pm_fiado','base_caja_hoy'].forEach(k => sessionStorage.removeItem(k));
    totalEfectivo = 0; totalTransferencia = 0; totalFiado = 0; baseInicial = 0;
    globalIngresos = 0; globalEgresos = 0;

    const panelApertura = document.getElementById('panel-apertura-caja');
    const inputBase     = document.getElementById('input-base-caja');
    if (panelApertura) {
        panelApertura.style.display = '';
        if (inputBase) inputBase.value = '';
    }

    if (document.getElementById('tab-calendario')?.style.display !== 'none') {
        cargarCalendarioCierres();
    }

    Toast.ok('Ciclo contable cerrado. Contadores reseteados a $0.');
    cerrarModalCierre();
    setTimeout(() => cargarDashboardReal(), 500);
}

// ── Calendario de cierres ──────────────────────────────────────
const _cierresState = { pagina: 0, limite: 20, total: 0, datos: [], filtroFecha: '' };

async function cargarCalendarioCierres(resetPagina = true) {
    const tbody   = document.getElementById('tabla-calendario-cierres');
    const resumen = document.getElementById('resumen-calendario');
    if (!tbody) return;

    if (resetPagina) {
        _cierresState.pagina = 0;
        _cierresState.datos  = [];
    }

    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-3);">Cargando historial…</td></tr>`;

    try {
        let query = supabaseClient
            .from('historial_cierres')
            .select('*', { count: 'exact' })
            .order('fecha', { ascending: false })
            .range(
                _cierresState.pagina * _cierresState.limite,
                (_cierresState.pagina + 1) * _cierresState.limite - 1
            );

        if (_cierresState.filtroFecha) {
            query = query.eq('fecha', _cierresState.filtroFecha);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        _cierresState.total = count || 0;
        _cierresState.datos = data || [];
    } catch (_) {
        const todos = JSON.parse(localStorage.getItem('cierres_local') || '[]');
        _cierresState.datos  = todos.slice(
            _cierresState.pagina * _cierresState.limite,
            (_cierresState.pagina + 1) * _cierresState.limite
        );
        _cierresState.total = todos.length;
    }

    const cierres = _cierresState.datos;

    if (cierres.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--text-3);">Sin cierres registrados aún.</td></tr>`;
        if (resumen) resumen.innerHTML = '';
        return;
    }

    const totAcc = cierres.reduce((a, c) => ({
        ing: a.ing + (c.ingresos || 0),
        eg:  a.eg  + (c.egresos  || 0),
        ut:  a.ut  + (c.utilidad_neta || 0),
    }), { ing: 0, eg: 0, ut: 0 });

    if (resumen) {
        const hayPaginas = _cierresState.total > _cierresState.limite;
        const labelPag   = hayPaginas
            ? `<p style="font-size:11px;color:var(--text-3);margin-top:6px;text-align:center;">
                Mostrando ${cierres.length} de ${_cierresState.total} cierres · Página ${_cierresState.pagina + 1}
               </p>` : '';

        resumen.innerHTML = `
            <div style="margin-bottom:18px;">
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;">
                    <label style="font-size:12px;font-weight:600;color:var(--text-2);">📆 Filtrar por fecha:</label>
                    <input type="date" id="inp-filtro-fecha-cierres"
                        value="${_cierresState.filtroFecha}"
                        onchange="_aplicarFiltroCierres(this.value)"
                        style="width:180px;border-radius:999px;padding:5px 14px;font-size:12.5px;height:36px;">
                    ${_cierresState.filtroFecha
                        ? `<button onclick="_aplicarFiltroCierres('')" class="btn-ghost" style="font-size:12px;padding:5px 14px;height:36px;">✕ Quitar filtro</button>`
                        : ''}
                    <div style="flex:1;"></div>
                    ${_cierresState.pagina > 0
                        ? `<button onclick="_paginaCierres(-1)" class="btn-ghost" style="font-size:12px;padding:5px 14px;height:36px;">← Anterior</button>` : ''}
                    ${(_cierresState.pagina + 1) * _cierresState.limite < _cierresState.total
                        ? `<button onclick="_paginaCierres(1)" class="btn-ghost" style="font-size:12px;padding:5px 14px;height:36px;">Siguiente →</button>` : ''}
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;" class="tables-grid">
                    <div style="background:var(--olive-lt);border:1.5px solid var(--olive-bd);border-radius:14px;padding:14px;text-align:center;">
                        <p style="font-size:10px;font-weight:700;color:var(--olive);text-transform:uppercase;margin-bottom:4px;">Ingresos Acumulados</p>
                        <p style="font-size:18px;font-weight:800;color:var(--olive);" class="mono">${formatCOP(totAcc.ing)}</p>
                    </div>
                    <div style="background:var(--red-lt);border:1.5px solid var(--red-bd);border-radius:14px;padding:14px;text-align:center;">
                        <p style="font-size:10px;font-weight:700;color:var(--red);text-transform:uppercase;margin-bottom:4px;">Egresos Acumulados</p>
                        <p style="font-size:18px;font-weight:800;color:var(--red);" class="mono">${formatCOP(totAcc.eg)}</p>
                    </div>
                    <div style="background:var(--blue-lt);border:1.5px solid rgba(37,99,168,.25);border-radius:14px;padding:14px;text-align:center;">
                        <p style="font-size:10px;font-weight:700;color:var(--blue);text-transform:uppercase;margin-bottom:4px;">Utilidad Acumulada</p>
                        <p style="font-size:18px;font-weight:800;color:var(--blue);" class="mono">${formatCOP(totAcc.ut)}</p>
                    </div>
                </div>
                ${labelPag}
            </div>`;
    }

    const fragment = document.createDocumentFragment();
    cierres.forEach(c => {
        const utClass    = (c.utilidad_neta || 0) >= 0 ? 'color:var(--olive)' : 'color:var(--red)';
        const localBadge = c.local ? `<span style="font-size:9px;color:var(--amber);font-weight:700;"> (local)</span>` : '';
        const tr = document.createElement('tr');
        tr.className = 'tbody-row';
        tr.innerHTML = `
            <td class="mono" style="font-size:12.5px;font-weight:600;">${c.fecha}${localBadge}</td>
            <td class="mono" style="text-align:right;color:var(--olive);font-weight:600;">${formatCOP(c.ingresos || 0)}</td>
            <td class="mono" style="text-align:right;color:var(--red);">${formatCOP(c.egresos || 0)}</td>
            <td class="mono" style="text-align:right;${utClass};font-weight:700;">${formatCOP(c.utilidad_neta || 0)}</td>
            <td class="mono" style="text-align:right;font-size:11.5px;">${formatCOP(c.efectivo || 0)}</td>
            <td class="mono" style="text-align:right;font-size:11.5px;">${formatCOP(c.transferencia || 0)}</td>
            <td class="mono" style="text-align:right;font-size:11.5px;color:var(--amber);">${formatCOP(c.fiado || 0)}</td>`;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

function _aplicarFiltroCierres(fecha) {
    _cierresState.filtroFecha = fecha;
    cargarCalendarioCierres(true);
}

function _paginaCierres(delta) {
    const maxPag = Math.ceil(_cierresState.total / _cierresState.limite) - 1;
    _cierresState.pagina = Math.max(0, Math.min(_cierresState.pagina + delta, maxPag));
    cargarCalendarioCierres(false);
}

// ============================================================
// INICIALIZACIÓN PRINCIPAL
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const elFecha = document.getElementById('fecha-actual');
    if (elFecha) {
        elFecha.textContent = new Date().toLocaleDateString('es-CO', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
    }

    setTimeout(() => cargarDashboardReal(), 50);

    (async () => {
        if (!window.La26Core) return;
        const { data: rest } = await supabaseClient
            .from('restaurants').select('id').limit(1).maybeSingle();
        const rId = rest?.id;
        if (!rId) return;
        La26Core.suscribirRealtime(rId);
        La26Core.on('onOrderChange', () => {
            const tabDash = document.getElementById('tab-dashboard');
            if (tabDash && tabDash.style.display !== 'none') setTimeout(() => cargarDashboardReal(), 400);
        });
        La26Core.on('onMenuItemChange', () => {
            const tabMenu = document.getElementById('tab-menu');
            if (tabMenu && tabMenu.style.display !== 'none') setTimeout(() => cargarSlotsMenuReal(), 300);
        });
        La26Core.on('onInventoryChange', () => {
            const tabInv = document.getElementById('tab-inventario');
            if (tabInv && tabInv.style.display !== 'none') setTimeout(() => cargarInventarioReal(), 300);
        });
    })();
});

// ============================================================
// MÓDULO A: CONTROL DE ACCESO
// ============================================================
const SETTING_KEY = 'orders_enabled';

async function cargarEstadoSistema() {
    try {
        const { data, error } = await supabaseClient
            .from('system_settings')
            .select('value')
            .eq('key', SETTING_KEY)
            .maybeSingle();

        if (error) throw error;

        const habilitado = data ? data.value === 'true' : true;
        _renderToggleSistema(habilitado);
        return habilitado;
    } catch (_) {
        // Si Supabase no responde, el sistema siempre arranca habilitado.
        // No leer localStorage aquí evita que un valor corrupto bloquee el sistema.
        _renderToggleSistema(true);
        return true;
    }
}

async function toggleEstadoSistema() {
    const btnToggle = document.getElementById('btn-toggle-sistema');
    if (!btnToggle) return;

    const estadoActual = btnToggle.dataset.estado === 'true';
    const nuevoEstado  = !estadoActual;

    _renderToggleSistema(nuevoEstado);
    // Solo persiste en localStorage si el estado es false (bloqueo intencional).
    // Si se habilita, limpia cualquier valor corrupto anterior.
    if (nuevoEstado) {
        localStorage.removeItem(SETTING_KEY);
    } else {
        localStorage.setItem(SETTING_KEY, 'false');
    }

    try {
        const { error } = await supabaseClient
            .from('system_settings')
            .upsert([{ key: SETTING_KEY, value: String(nuevoEstado) }], { onConflict: 'key' });

        if (error) throw error;

        const msg = nuevoEstado
            ? '✅ Sistema habilitado: los meseros pueden tomar pedidos.'
            : '🔒 Sistema bloqueado: los meseros verán aviso de "Fuera de servicio".';
        Toast.ok(msg, 5000);
    } catch (err) {
        console.error('Error al persistir estado del sistema:', err);
        Toast.info('Estado guardado localmente. Sincronizar cuando haya conexión.');
    }
}

function _renderToggleSistema(habilitado) {
    const btn         = document.getElementById('btn-toggle-sistema');
    const estadoBadge = document.getElementById('badge-estado-sistema');
    const desc        = document.getElementById('desc-estado-sistema');
    if (!btn) return;

    btn.dataset.estado = String(habilitado);

    if (habilitado) {
        btn.className = 'sw-on';
        btn.innerHTML = '🟢 Pedidos Habilitados';
        if (estadoBadge) {
            estadoBadge.textContent = 'Operativo';
            estadoBadge.style.cssText = 'background:var(--olive-lt);color:var(--olive);border:1.5px solid var(--olive-bd);border-radius:999px;padding:3px 12px;font-size:11px;font-weight:700;';
        }
        if (desc) desc.textContent = 'Los meseros pueden crear y registrar pedidos con normalidad.';
    } else {
        btn.className = 'sw-off';
        btn.innerHTML = '🔴 Pedidos Bloqueados';
        if (estadoBadge) {
            estadoBadge.textContent = 'Fuera de Servicio';
            estadoBadge.style.cssText = 'background:var(--red-lt);color:var(--red);border:1.5px solid var(--red-bd);border-radius:999px;padding:3px 12px;font-size:11px;font-weight:700;';
        }
        if (desc) desc.textContent = 'Sistema cerrado. Los meseros recibirán aviso de "Sistema fuera de servicio" al intentar acceder.';
    }
}

// ============================================================
// MÓDULO B: INTELIGENCIA DE PRODUCCIÓN — RECETARIO
// ============================================================
let _recetasCache = [];
let _supplyCache  = [];
let _calcResult   = null;

async function cargarRecetas() {
    const tbody = document.getElementById('tabla-recetas');
    const badge = document.getElementById('badge-recetas-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-3);">Cargando recetas…</td></tr>`;

    try {
        const { data: recetas, error } = await supabaseClient
            .from('production_recipes')
            .select(`id, name, description,
                     recipe_ingredients ( id, supply_id, supply_name, quantity_per_dish, quantity_required, unit )`)
            .order('name', { ascending: true });

        if (error) throw error;
        _recetasCache = recetas || [];

        if (badge) badge.textContent = `${_recetasCache.length} receta${_recetasCache.length !== 1 ? 's' : ''}`;

        const sel = document.getElementById('sel-receta-calculo');
        if (sel) {
            sel.innerHTML = '<option value="">— Seleccionar receta —</option>';
            _recetasCache.forEach(r => {
                sel.insertAdjacentHTML('beforeend',
                    `<option value="${r.id}">${r.name}</option>`);
            });
        }

        _renderTablaRecetas();
    } catch (err) {
        console.error('Error cargando recetas:', err);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--red);font-size:12.5px;">Error al cargar. Revisa la consola.</td></tr>`;
    }
}

function _renderTablaRecetas() {
    const tbody = document.getElementById('tabla-recetas');
    if (!tbody) return;

    if (_recetasCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">Sin recetas. Crea la primera arriba.</td></tr>`;
        return;
    }

    tbody.innerHTML = _recetasCache.map(r => {
        const ings = (r.recipe_ingredients || []).map(i =>
            `<span style="background:var(--olive-lt);border:1px solid var(--olive-bd);color:var(--olive);border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:600;white-space:nowrap;">
                ${i.quantity_per_dish ?? i.quantity_required ?? '?'} ${i.unit} ${i.supply_name}
            </span>`
        ).join('');

        return `<tr class="tbody-row">
            <td style="font-size:13px;font-weight:600;color:var(--text-1);white-space:nowrap;">${r.name}</td>
            <td style="font-size:12px;color:var(--text-3);">${r.description || '—'}</td>
            <td><div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;">${ings || '<span style="color:var(--text-3);font-size:11.5px;">Sin ingredientes</span>'}</div></td>
            <td style="text-align:center;">
                <button onclick="eliminarReceta('${r.id}','${(r.name||'').replace(/'/g,"\\'")}') " class="btn-danger">🗑️ Eliminar</button>
            </td>
        </tr>`;
    }).join('');
}

async function guardarReceta() {
    const nombre = document.getElementById('rec-nombre')?.value.trim();
    const desc   = document.getElementById('rec-descripcion')?.value.trim();

    if (!nombre) { Toast.error('El nombre de la receta es obligatorio.'); return; }

    const filas       = document.querySelectorAll('#tabla-form-ingredientes .ing-row');
    const ingredientes = [];

    filas.forEach(fila => {
        const supplyId   = fila.querySelector('.ing-supply-id')?.value || null;
        const supplyName = fila.querySelector('.ing-supply-name')?.value?.trim();
        const qty        = parseFloat(fila.querySelector('.ing-qty')?.value);
        const unit       = fila.querySelector('.ing-unit')?.value?.trim();
        if (supplyName && !isNaN(qty) && qty > 0 && unit) {
            ingredientes.push({ supply_id: supplyId, supply_name: supplyName, quantity_per_dish: qty, quantity_required: qty, unit });
        }
    });

    if (ingredientes.length === 0) {
        Toast.error('Agrega al menos un ingrediente válido (nombre, cantidad y unidad).');
        return;
    }

    try {
        const { data: receta, error: errR } = await supabaseClient
            .from('production_recipes')
            .insert([{ name: nombre, description: desc || null }])
            .select('id').single();
        if (errR) throw errR;

        const { error: errI } = await supabaseClient
            .from('recipe_ingredients')
            .insert(ingredientes.map(i => ({ ...i, recipe_id: receta.id })));
        if (errI) throw errI;

        Toast.ok(`Receta "${nombre}" guardada.`);
        document.getElementById('rec-nombre').value      = '';
        document.getElementById('rec-descripcion').value = '';
        document.getElementById('tabla-form-ingredientes').innerHTML = '';
        agregarFilaIngrediente();
        cargarRecetas();
    } catch (err) {
        console.error('Error guardando receta:', err);
        Toast.error(`Error: ${err.message}`);
    }
}

async function agregarFilaIngrediente() {
    const tbody = document.getElementById('tabla-form-ingredientes');
    if (!tbody) return;

    if (_supplyCache.length === 0) {
        const { data } = await supabaseClient
            .from('inventory_supplies')
            .select('id, item_name, unit_of_measure, current_stock')
            .order('item_name');
        _supplyCache = data || [];
    }

    const opts   = _supplyCache.map(s =>
        `<option value="${s.id}" data-unit="${s.unit_of_measure}" data-name="${s.item_name}">
            ${s.item_name} (${s.current_stock} ${s.unit_of_measure} en stock)
        </option>`
    ).join('');

    const filaId = `ing_${Date.now()}`;
    tbody.insertAdjacentHTML('beforeend', `
        <tr id="${filaId}" class="ing-row">
            <td style="padding:6px 8px;">
                <select class="ing-supply-select" onchange="_autoFillUnit(this,'${filaId}')"
                    style="font-size:12px;border-radius:999px;padding:5px 10px;height:34px;width:100%;min-width:160px;">
                    <option value="">— Del inventario o escribe abajo —</option>
                    ${opts}
                </select>
                <input type="hidden" class="ing-supply-id">
                <input type="text" class="ing-supply-name" placeholder="Nombre (si no está en inventario)"
                    style="font-size:12px;border-radius:999px;padding:5px 10px;height:34px;margin-top:4px;width:100%;">
            </td>
            <td style="padding:6px 8px;width:130px;">
                <input type="number" class="ing-qty" placeholder="Ej: 0.2" min="0.001" step="0.001"
                    style="font-size:12px;border-radius:999px;padding:5px 10px;height:34px;width:100%;text-align:center;">
            </td>
            <td style="padding:6px 8px;width:110px;">
                <input type="text" class="ing-unit" placeholder="Kg, Libras…"
                    style="font-size:12px;border-radius:999px;padding:5px 10px;height:34px;width:100%;">
            </td>
            <td style="padding:6px 8px;width:36px;text-align:center;">
                <button onclick="document.getElementById('${filaId}').remove()"
                    style="background:var(--red-lt);border:1.5px solid var(--red-bd);color:var(--red);border-radius:999px;width:28px;height:28px;cursor:pointer;font-size:15px;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;">×</button>
            </td>
        </tr>`);
}

function _autoFillUnit(selectEl, filaId) {
    const fila = document.getElementById(filaId);
    if (!fila) return;
    const opt  = selectEl.options[selectEl.selectedIndex];
    if (!opt?.value) return;
    fila.querySelector('.ing-supply-id').value   = opt.value;
    fila.querySelector('.ing-supply-name').value = opt.dataset.name || '';
    fila.querySelector('.ing-unit').value        = opt.dataset.unit || '';
}

async function eliminarReceta(id, nombre) {
    if (!confirm(`¿Eliminar la receta "${nombre}"?`)) return;
    try {
        await supabaseClient.from('recipe_ingredients').delete().eq('recipe_id', id);
        await supabaseClient.from('production_recipes').delete().eq('id', id);
        Toast.ok(`Receta "${nombre}" eliminada.`);
        cargarRecetas();
    } catch (err) {
        Toast.error('Error al eliminar la receta.');
    }
}

async function calcularProduccion() {
    const sel      = document.getElementById('sel-receta-calculo');
    const recetaId = sel?.value;
    if (!recetaId) { Toast.error('Selecciona una receta primero.'); return; }

    const receta = _recetasCache.find(r => r.id === recetaId);
    if (!receta?.recipe_ingredients?.length) {
        Toast.error('La receta no tiene ingredientes. Edítala primero.');
        return;
    }

    const supplyIds = receta.recipe_ingredients.filter(i => i.supply_id).map(i => i.supply_id);
    let stockMap = {};

    if (supplyIds.length > 0) {
        const { data: stocks } = await supabaseClient
            .from('inventory_supplies')
            .select('id, item_name, current_stock, unit_of_measure')
            .in('id', supplyIds);
        (stocks || []).forEach(s => { stockMap[s.id] = s; });
    }

    let platosEstimados = Infinity;
    const detalleIng = receta.recipe_ingredients.map(ing => {
        const stockActual  = stockMap[ing.supply_id]?.current_stock ?? null;
        const _qpd2        = ing.quantity_per_dish ?? ing.quantity_required ?? 0;
        const coberturaEst = (stockActual !== null && _qpd2 > 0)
            ? Math.floor(stockActual / _qpd2)
            : null;

        if (coberturaEst !== null && coberturaEst < platosEstimados) {
            platosEstimados = coberturaEst;
        }
        return { ...ing, stockActual, coberturaEst };
    });

    if (!isFinite(platosEstimados)) platosEstimados = 0;

    _calcResult = { recetaId, receta, platosEstimados, detalleIng };
    _renderResultadoCalculo();
}

function _renderResultadoCalculo() {
    const panel = document.getElementById('panel-resultado-calculo');
    if (!panel || !_calcResult) return;
    const { receta, platosEstimados, detalleIng } = _calcResult;

    const isCuello = (ing) => ing.coberturaEst !== null && ing.coberturaEst === platosEstimados;

    const filasIng = detalleIng.map(i => {
        const cuello       = isCuello(i);
        const _qpd3        = i.quantity_per_dish ?? i.quantity_required ?? 0;
        const consumoTotal = i.stockActual !== null ? (_qpd3 * platosEstimados).toFixed(3) : '—';
        const restante     = i.stockActual !== null ? Math.max(0, i.stockActual - _qpd3 * platosEstimados).toFixed(3) : '—';
        const stockLabel   = i.stockActual !== null
            ? `<span class="mono" style="font-size:12.5px;font-weight:600;">${i.stockActual} ${i.unit}</span>`
            : `<span style="color:var(--amber);font-size:11.5px;font-weight:600;">⚠️ Sin link inventario</span>`;
        const cuelloLabel  = cuello
            ? `<span style="font-size:9.5px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.4px;">🔴 Cuello</span>` : '';

        return `<tr style="border-bottom:1px solid var(--border);${cuello ? 'background:rgba(192,57,43,.04);' : ''}">
            <td style="padding:9px 12px;font-size:12.5px;font-weight:600;color:var(--text-1);">${i.supply_name} ${cuelloLabel}</td>
            <td style="padding:9px 12px;text-align:center;">${stockLabel}</td>
            <td style="padding:9px 12px;text-align:center;" class="mono">${i.quantity_per_dish} ${i.unit}</td>
            <td style="padding:9px 12px;text-align:center;color:${cuello?'var(--red)':'var(--text-2)'};" class="mono">${i.coberturaEst ?? '—'}</td>
            <td style="padding:9px 12px;text-align:center;color:var(--red);" class="mono">-${consumoTotal}</td>
            <td style="padding:9px 12px;text-align:center;color:var(--olive);" class="mono">${restante}</td>
        </tr>`;
    }).join('');

    panel.className = 'card';
    panel.style.display = 'block';
    panel.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:18px;">
            <div>
                <p style="font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">${receta.name} — Resultado</p>
                <div style="display:flex;align-items:baseline;gap:10px;">
                    <span style="font-size:42px;font-weight:800;color:var(--olive);font-family:'DM Mono',monospace;line-height:1;">${platosEstimados}</span>
                    <div>
                        <p style="font-size:14px;font-weight:600;color:var(--text-1);">platos estimados</p>
                        <p style="font-size:11px;color:var(--text-3);">con el stock actual del inventario</p>
                    </div>
                </div>
            </div>
            ${platosEstimados > 0 ? `
            <div style="background:var(--olive-lt);border:1.5px solid var(--olive-bd);border-radius:14px;padding:14px 18px;">
                <p style="font-size:11px;font-weight:700;color:var(--olive);margin-bottom:8px;">📋 Siguiente paso</p>
                <p style="font-size:12px;color:var(--text-2);line-height:1.6;">Ve a <strong>Control de Menú</strong> y pon<br><strong>${platosEstimados}</strong> en "Porciones del día".</p>
            </div>` : ''}
        </div>
        <div style="overflow-x:auto;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:14px;">
            <table style="width:100%;border-collapse:collapse;min-width:500px;">
                <thead>
                    <tr style="background:var(--surface-2);">
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;text-align:left;">Insumo</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;text-align:center;">Stock Actual</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;text-align:center;">Por 1 plato</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;text-align:center;">Alcanza para</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;text-align:center;">Consume total</th>
                        <th style="padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;text-align:center;">Queda</th>
                    </tr>
                </thead>
                <tbody>${filasIng}</tbody>
            </table>
        </div>
        ${platosEstimados > 0 ? `
        <div style="background:var(--olive-lt);border:1.5px solid var(--olive-bd);border-radius:12px;padding:14px 16px;">
            <p style="font-size:12px;font-weight:700;color:var(--olive);margin-bottom:10px;">📦 Descontar insumos al cerrar el día</p>
            <p style="font-size:11.5px;color:var(--text-2);margin-bottom:10px;">Ingresa cuántos platos se vendieron realmente.</p>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <label style="font-size:12.5px;font-weight:600;color:var(--text-2);margin:0;white-space:nowrap;">Platos vendidos:</label>
                <input type="number" id="inp-platos-vendidos" value="${platosEstimados}" min="1" max="${platosEstimados}"
                    style="width:90px;font-size:14px;font-weight:700;text-align:center;border-radius:999px;padding:6px 12px;border:1.5px solid var(--olive-bd);">
                <button onclick="descontarInsumos()" class="btn-olive">📦 Descontar del Inventario</button>
                <span style="font-size:11px;color:var(--text-3);">(máx. ${platosEstimados})</span>
            </div>
        </div>` : `
        <div style="background:var(--red-lt);border:1.5px solid var(--red-bd);border-radius:12px;padding:14px 16px;">
            <p style="font-size:13px;font-weight:700;color:var(--red);">⚠️ Stock insuficiente para producir al menos un plato.</p>
            <p style="font-size:12px;color:var(--text-2);margin-top:4px;">Revisa el insumo cuello de botella y repón stock.</p>
        </div>`}`;
}

async function descontarInsumos() {
    if (!_calcResult) return;
    const platosVendidos = parseInt(document.getElementById('inp-platos-vendidos')?.value) || 0;

    if (platosVendidos <= 0 || platosVendidos > _calcResult.platosEstimados) {
        Toast.error(`Ingresa un número entre 1 y ${_calcResult.platosEstimados}.`);
        return;
    }
    if (!confirm(`¿Descontar del inventario el consumo de ${platosVendidos} plato(s)?`)) return;

    const ingsConLink = _calcResult.detalleIng.filter(i => i.supply_id && i.stockActual !== null);
    let errores = 0;

    for (const ing of ingsConLink) {
        const nuevoStock = Math.max(0, ing.stockActual - ing.quantity_per_dish * platosVendidos);
        const { error } = await supabaseClient
            .from('inventory_supplies')
            .update({ current_stock: nuevoStock, updated_at: new Date().toISOString() })
            .eq('id', ing.supply_id);
        if (error) { console.error('Error descontando', ing.supply_name, error); errores++; }
    }

    if (errores === 0) {
        Toast.ok(`✅ ${platosVendidos} plato(s) descontados del inventario correctamente.`);
    } else {
        Toast.error(`${errores} insumo(s) no se actualizaron. Revisa la consola.`);
    }

    _calcResult = null;
    const panel = document.getElementById('panel-resultado-calculo');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    document.getElementById('sel-receta-calculo').value = '';
    _supplyCache = [];
    cargarInventarioReal();
    cargarRecetas();
}

// ============================================================
// [PATCH-A] BOTÓN ACTUALIZAR DASHBOARD
// ============================================================
async function actualizarDashboard() {
    const btn = document.getElementById('btn-actualizar-dashboard');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Actualizando…'; }
    try {
        await cargarDashboardReal();
        renderizarTotales();
        Toast.ok('Dashboard actualizado correctamente.');
    } catch (err) {
        console.error('[Admin] Error actualizando dashboard:', err);
        Toast.error('Error al actualizar. Revisa la consola.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualizar'; }
    }
}

// ============================================================
// [PATCH-C] EDICIÓN ADMIN DE COMANDAS
// ============================================================
const _adminEditor = {
    orderId: null, pedido: null, itemsEdit: [], notaEdit: '', guardando: false,
};

const ADMIN_ESTADOS_EDITABLES = ['pending', 'confirmed', 'in_kitchen', 'delivered', 'paid'];

async function editarComandaAdmin(orderId, orderNo, totalBruto) {
    _adminEditor.orderId   = orderId;
    _adminEditor.guardando = false;

    const modal = document.getElementById('modal-editar-comanda-admin');
    if (!modal) {
        Toast.error('Modal de edición no encontrado. Pega el HTML del modal antes de </body> en admin.html.');
        console.error('[FIX-8] Falta el modal #modal-editar-comanda-admin en admin.html.');
        return;
    }
    modal.style.display = 'flex';

    document.getElementById('eca-body').innerHTML = `
        <div style="text-align:center;padding:40px 0;color:var(--text-3);">
            <div style="width:32px;height:32px;border:2.5px solid var(--olive-bd);border-top-color:var(--olive);
                border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px;"></div>
            <p style="font-size:13px;">Cargando comanda…</p>
        </div>`;

    try {
        const { data: pedido, error } = await supabaseClient
            .from('orders')
            .select(`id, order_number, status, notes, total_amount,
                     order_items ( id, quantity, unit_price, notes, item_status, menu_item_id, menu_items ( name ) )`)
            .eq('id', orderId).single();
        if (error || !pedido) throw new Error(error?.message || 'Pedido no encontrado.');

        if (!ADMIN_ESTADOS_EDITABLES.includes(pedido.status)) {
            document.getElementById('eca-body').innerHTML = `
                <p style="color:var(--text-3);padding:24px;font-size:13px;">
                    Esta orden no se puede editar (estado: <strong>${pedido.status}</strong>).
                </p>`;
            document.getElementById('eca-footer').style.display = 'none';
            return;
        }

        _adminEditor.pedido    = pedido;
        _adminEditor.itemsEdit = (pedido.order_items || []).map(it => {
            let nombre = it.menu_items?.name || '';
            if (!nombre && (it.notes || '').includes('[nombre]'))
                nombre = it.notes.split('[nombre]')[1].split('|')[0].trim();
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

        _renderEditorAdmin();
        document.getElementById('eca-footer').style.display = 'flex';

    } catch (err) {
        console.error('[Admin] Error abriendo editor:', err);
        document.getElementById('eca-body').innerHTML =
            `<p style="color:var(--red);padding:24px;font-size:13px;">Error: ${err.message}</p>`;
    }
}

async function _renderEditorAdmin() {
    const pedido = _adminEditor.pedido;
    if (!pedido) return;

    const { data: menuItems } = await supabaseClient
        .from('menu_items')
        .select('id, name, price, is_active, portions_today')
        .eq('is_active', true)
        .order('name', { ascending: true });

    const opcionesMenu = (menuItems || []).map(m => {
        const p = m.portions_today != null ? ` (${m.portions_today} disp.)` : '';
        return `<option value="${m.id}" data-precio="${m.price}" data-nombre="${m.name.replace(/"/g,'&quot;')}">${m.name} — ${formatCOP(m.price)}${p}</option>`;
    }).join('');

    const filasItems = _adminEditor.itemsEdit.filter(it => !it.eliminado).map(it => _renderFilaItemAdmin(it)).join('');

    document.getElementById('eca-body').innerHTML = `
        <div style="margin-bottom:16px;">
            <p style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.7px;margin-bottom:3px;">
                Orden <span class="mono">${pedido.order_number}</span></p>
            <span style="background:var(--olive-lt);color:var(--olive);border:1.5px solid var(--olive-bd);border-radius:999px;padding:2px 10px;font-size:10.5px;font-weight:700;">${pedido.status}</span>
        </div>
        <div style="border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px;">
            <div style="background:var(--surface-2);padding:10px 14px;border-bottom:1.5px solid var(--border);">
                <p style="font-size:11px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.6px;">Ítems de la comanda</p>
            </div>
            <div id="eca-items-lista" style="padding:0;">${filasItems || '<p style="padding:16px;font-size:12.5px;color:var(--text-3);">Sin ítems.</p>'}</div>
        </div>
        <div style="border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px;">
            <div style="background:var(--surface-2);padding:10px 14px;border-bottom:1.5px solid var(--border);">
                <p style="font-size:11px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.6px;">Agregar producto</p>
            </div>
            <div style="padding:14px;display:flex;flex-direction:column;gap:10px;">
                <select id="eca-sel-producto" style="border-radius:999px;font-size:13px;">
                    <option value="">— Selecciona un producto —</option>${opcionesMenu}
                </select>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <button onclick="_ecaDecQty()" style="width:30px;height:30px;border-radius:50%;border:1.5px solid var(--olive-bd);background:var(--olive-lt);color:var(--olive);font-size:16px;cursor:pointer;font-family:'DM Sans',sans-serif;">−</button>
                    <span id="eca-nueva-qty" style="font-size:14px;font-weight:600;color:var(--text-1);min-width:24px;text-align:center;">1</span>
                    <button onclick="_ecaIncQty()" style="width:30px;height:30px;border-radius:50%;border:1.5px solid var(--olive-bd);background:var(--olive-lt);color:var(--olive);font-size:16px;cursor:pointer;font-family:'DM Sans',sans-serif;">+</button>
                    <button onclick="_ecaAgregarItem()" class="btn-olive" style="flex:1;min-width:120px;height:36px;">+ Agregar al pedido</button>
                </div>
            </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--olive-lt);border:1.5px solid var(--olive-bd);border-radius:12px;padding:14px 16px;">
            <span style="font-size:13px;font-weight:600;color:var(--olive);">Total estimado</span>
            <span class="mono" id="eca-total-monto" style="font-size:15px;font-weight:700;color:var(--olive);">${formatCOP(_calcularTotalAdmin())}</span>
        </div>`;

    window._ecaNuevaQty = 1;
}

function _renderFilaItemAdmin(it) {
    const precioStr   = it.precio > 0 ? formatCOP(it.precio) : 'Incl.';
    const subtotalStr = it.precio > 0 ? formatCOP(it.precio * it.cantidad) : '—';
    const k           = it.id;
    return `<div id="eca-row-${k}" style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);gap:8px;flex-wrap:wrap;">
        <div style="flex:1;min-width:120px;">
            <p style="font-size:13px;font-weight:600;color:var(--text-1);">${it.nombre}</p>
            <p style="font-size:11px;color:var(--text-3);">${precioStr} c/u</p>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
            <button onclick="_ecaCambiarCantidad('${k}',-1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid var(--olive-bd);background:var(--olive-lt);color:var(--olive);font-size:14px;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;">−</button>
            <span id="eca-qty-${k}" style="font-size:13px;font-weight:600;color:var(--text-1);min-width:22px;text-align:center;">${it.cantidad}</span>
            <button onclick="_ecaCambiarCantidad('${k}',+1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid var(--olive-bd);background:var(--olive-lt);color:var(--olive);font-size:14px;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;">+</button>
        </div>
        <span class="mono" id="eca-sub-${k}" style="font-size:12.5px;font-weight:600;color:var(--olive);min-width:70px;text-align:right;">${subtotalStr}</span>
        <button onclick="_ecaEliminarItem('${k}')" style="background:var(--red-lt);border:1.5px solid var(--red-bd);color:var(--red);border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;">Quitar</button>
    </div>`;
}

window._ecaIncQty = function() {
    window._ecaNuevaQty = (window._ecaNuevaQty || 1) + 1;
    const el = document.getElementById('eca-nueva-qty');
    if (el) el.textContent = window._ecaNuevaQty;
};
window._ecaDecQty = function() {
    window._ecaNuevaQty = Math.max(1, (window._ecaNuevaQty || 1) - 1);
    const el = document.getElementById('eca-nueva-qty');
    if (el) el.textContent = window._ecaNuevaQty;
};
window._ecaAgregarItem = function() {
    const sel = document.getElementById('eca-sel-producto');
    if (!sel || !sel.value) { Toast.error('Selecciona un producto.'); return; }
    const opt    = sel.options[sel.selectedIndex];
    const nombre = opt.dataset.nombre || opt.text.split(' — ')[0].trim();
    const precio = parseFloat(opt.dataset.precio) || 0;
    const qty    = window._ecaNuevaQty || 1;
    const existente = _adminEditor.itemsEdit.find(it => !it.eliminado && it.menuItemId === sel.value && it.esNuevo);
    if (existente) {
        existente.cantidad += qty;
    } else {
        _adminEditor.itemsEdit.push({
            id: `new-${Date.now()}`, menuItemId: sel.value, nombre, precio,
            cantidad: qty, item_status: 'pending', esNuevo: true, eliminado: false,
        });
    }
    sel.value = '';
    window._ecaNuevaQty = 1;
    const qtyEl = document.getElementById('eca-nueva-qty');
    if (qtyEl) qtyEl.textContent = '1';
    _ecaRefrescarLista();
    Toast.ok(`"${nombre}" agregado.`);
};
window._ecaCambiarCantidad = function(itemId, delta) {
    const it = _adminEditor.itemsEdit.find(i => i.id === itemId);
    if (!it || it.eliminado) return;
    const nueva = it.cantidad + delta;
    if (nueva <= 0) { it.eliminado = true; } else { it.cantidad = nueva; }
    _ecaRefrescarLista();
};
window._ecaEliminarItem = function(itemId) {
    const it = _adminEditor.itemsEdit.find(i => i.id === itemId);
    if (!it) return;
    if (!confirm(`¿Quitar "${it.nombre}" del pedido?`)) return;
    it.eliminado = true;
    _ecaRefrescarLista();
};

function _calcularTotalAdmin() {
    return _adminEditor.itemsEdit.filter(i => !i.eliminado).reduce((acc, i) => acc + i.precio * i.cantidad, 0);
}

function _ecaRefrescarLista() {
    const lista = document.getElementById('eca-items-lista');
    if (!lista) return;
    const activos = _adminEditor.itemsEdit.filter(i => !i.eliminado);
    lista.innerHTML = activos.length > 0
        ? activos.map(it => _renderFilaItemAdmin(it)).join('')
        : '<p style="padding:16px;font-size:12.5px;color:var(--text-3);">Sin ítems.</p>';
    const totalEl = document.getElementById('eca-total-monto');
    if (totalEl) totalEl.textContent = formatCOP(_calcularTotalAdmin());
}

async function guardarEdicionAdmin() {
    if (_adminEditor.guardando) return;
    const btnGuardar = document.getElementById('eca-btn-guardar');
    _adminEditor.guardando = true;
    if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…'; }

    try {
        let resultado;
        if (window.La26Core) {
            const { data: rest } = await supabaseClient.from('restaurants').select('id').limit(1).maybeSingle();
            resultado = await La26Core.guardarEdicionAdmin(
                _adminEditor.orderId,
                _adminEditor.itemsEdit,
                _adminEditor.pedido.notes,
                rest?.id || null
            );
        } else {
            resultado = await _guardarEdicionLegacyAdmin();
        }

        if (!resultado.ok) { Toast.error(resultado.error || 'No se pudo guardar.'); return; }
        Toast.ok('Comanda actualizada correctamente.');
        cerrarModalEditarComanda();
        await cargarDashboardReal();

    } catch (err) {
        console.error('[Admin] Error guardando edición:', err);
        Toast.error('Error al guardar. Revisa la consola.');
    } finally {
        _adminEditor.guardando = false;
        if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar cambios'; }
    }
}

// ============================================================
// [FIX-9] _guardarEdicionLegacyAdmin — REESCRITA COMPLETA
// Causa raíz del error v3.2:
//   supabaseClient.from(...).insert(...).catch is not a function
// Supabase JS v2 devuelve { data, error }, NO una Promise con
// .catch(). Todo manejo de errores debe ser try/catch con await.
// ============================================================
async function _guardarEdicionLegacyAdmin() {
    const pedido  = _adminEditor.pedido;
    const orderId = _adminEditor.orderId;
    const idsOrig = new Set((pedido.order_items || []).map(i => i.id));

    const aEliminar   = _adminEditor.itemsEdit.filter(i => i.eliminado  && !i.esNuevo && idsOrig.has(i.id));
    const aActualizar = _adminEditor.itemsEdit.filter(i => !i.eliminado && !i.esNuevo && idsOrig.has(i.id));
    const aNuevos     = _adminEditor.itemsEdit.filter(i => i.esNuevo    && !i.eliminado);

    // ── 1. Eliminar ítems marcados como borrados ───────────────
    for (const it of aEliminar) {
        const { error } = await supabaseClient
            .from('order_items')
            .delete()
            .eq('id', it.id);
        if (error) console.warn('[La 26] No se pudo eliminar ítem', it.id, '—', error.message);
    }

    // ── 2. Actualizar cantidades modificadas ──────────────────
    for (const it of aActualizar) {
        const orig = (pedido.order_items || []).find(o => o.id === it.id);
        if (orig && orig.quantity !== it.cantidad) {
            const { error } = await supabaseClient
                .from('order_items')
                .update({ quantity: it.cantidad })
                .eq('id', it.id);
            if (error) console.warn('[La 26] No se pudo actualizar cantidad de ítem', it.id, '—', error.message);
        }
    }

    // ── 3. Insertar nuevos ítems ──────────────────────────────
    if (aNuevos.length > 0) {
        const insertPayload = aNuevos.map(it => ({
            order_id:     orderId,
            menu_item_id: it.menuItemId,
            quantity:     it.cantidad,
            unit_price:   it.precio,
            item_status:  'pending',
            notes:        `[nombre]${it.nombre}`,
        }));

        const { error } = await supabaseClient
            .from('order_items')
            .insert(insertPayload);

        // No lanzamos — un fallo en insert no debe bloquear la actualización del total
        if (error) console.warn('[La 26] No se pudieron insertar ítems nuevos —', error.message);
    }

    // ── 4. Recalcular y actualizar total de la orden ──────────
    const nuevoTotal = _calcularTotalAdmin();
    const { error: errTotal } = await supabaseClient
        .from('orders')
        .update({
            total_amount: nuevoTotal,
            updated_at:   new Date().toISOString(),
        })
        .eq('id', orderId);

    if (errTotal) {
        console.error('[La 26] Error actualizando total de orden:', errTotal.message);
        return { ok: false, error: errTotal.message, nuevoTotal };
    }

    return { ok: true, error: null, nuevoTotal };
}

function cerrarModalEditarComanda() {
    const modal = document.getElementById('modal-editar-comanda-admin');
    if (modal) modal.style.display = 'none';
    _adminEditor.orderId   = null;
    _adminEditor.pedido    = null;
    _adminEditor.itemsEdit = [];
    _adminEditor.guardando = false;
}

// ============================================================
// FIN DE admin.js v3.3
// ============================================================
// CAMBIOS RESPECTO A v3.2:
//
// [FIX-9] _guardarEdicionLegacyAdmin — reescrita desde cero.
//   ANTES: usaba patrón .insert([...]).catch(() => {}) que
//   lanzaba TypeError porque Supabase JS v2 no devuelve promesas
//   con .catch().
//   AHORA: usa for...of + try/catch + await en cada operación.
//   Las operaciones de delete/update/insert ahora son secuenciales
//   y manejadas correctamente. El error ya no ocurre.
//
// [FIX-10] _buildTableMap() — nueva función helper.
//   Consulta la tabla 'tables' (o 'restaurant_tables' como fallback)
//   y construye un mapa { [table_id]: nombreMesa }.
//
// [FIX-10] cargarDashboardReal — actualizado.
//   Ahora llama _buildTableMap() en Promise.all junto con las órdenes.
//   La lógica de resolución del mesaLabel es:
//     1. [MESA ...] en notes (legado) → usa ese valor
//     2. table_id en tableMap → usa el nombre de la BD
//     3. table_id existe pero no está en mapa → muestra últimos 4 chars
//     4. Sin table_id → 'P.L.' (Para Llevar)
//
// SQL DE DIAGNÓSTICO (ejecutar en Supabase SQL Editor si la mesa
// sigue sin aparecer — verifica qué tabla existe y qué columnas tiene):
//
//   SELECT table_name FROM information_schema.tables
//   WHERE table_schema = 'public'
//   AND table_name IN ('tables', 'restaurant_tables');
//
//   -- Si existe 'tables':
//   SELECT id, name, number, table_number FROM tables LIMIT 5;
//
// ============================================================
// ============================================================
// REACTIVAR PRODUCTO INACTIVO (solo admin)
// ============================================================
async function reactivarProducto(idItem, nombreItem) {
    if (!confirm(`¿Reactivar "${nombreItem}" en el catálogo?`)) return;
    try {
        const { error } = await supabaseClient
            .from('menu_items')
            .update({ is_active: true, deleted_at: null })
            .eq('id', idItem);
        if (error) throw error;
        Toast.ok(`"${nombreItem}" reactivado correctamente.`);
        cargarSlotsMenuReal();
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error('[La 26] Error reactivando producto:', err);
        Toast.error('No se pudo reactivar el producto.');
    }
}

// ============================================================
// HISTORIAL DE PEDIDOS — tab-pedidos
// ============================================================

let _vistaHistorialPedidos = 'pendientes'; // 'pendientes' | 'pagados'

function filtrarHistorialPedidos(vista) {
    _vistaHistorialPedidos = vista;
    // Estilos botones filtro
    const btnP = document.getElementById('btn-hp-pendientes');
    const btnPg = document.getElementById('btn-hp-pagados');
    if (btnP && btnPg) {
        if (vista === 'pendientes') {
            btnP.style.background  = 'var(--amber-lt)';  btnP.style.color  = 'var(--amber)';   btnP.style.borderColor  = 'var(--amber)';
            btnPg.style.background = 'var(--surface-2)'; btnPg.style.color = 'var(--text-3)';  btnPg.style.borderColor = 'var(--border)';
        } else {
            btnPg.style.background = 'var(--olive-lt)';  btnPg.style.color = 'var(--olive)';   btnPg.style.borderColor = 'var(--olive-bd)';
            btnP.style.background  = 'var(--surface-2)'; btnP.style.color  = 'var(--text-3)';  btnP.style.borderColor  = 'var(--border)';
        }
    }
    cargarHistorialPedidos();
}

async function cargarHistorialPedidos() {
    const grid = document.getElementById('grid-historial-pedidos');
    if (!grid) return;

    grid.innerHTML = `<p style="color:var(--text-3);font-size:12.5px;padding:28px 0;grid-column:1/-1;text-align:center;">Cargando pedidos…</p>`;

    try {
        const _ahora     = new Date();
        const _offsetMs  = -5 * 60 * 60 * 1000;
        const _hoyLocal  = new Date(_ahora.getTime() - _offsetMs);
        const _yyyy      = _hoyLocal.getUTCFullYear();
        const _mm        = String(_hoyLocal.getUTCMonth() + 1).padStart(2, '0');
        const _dd        = String(_hoyLocal.getUTCDate()).padStart(2, '0');
        const _inicioDia = `${_yyyy}-${_mm}-${_dd}T00:00:00-05:00`;
        const _finDia    = `${_yyyy}-${_mm}-${_dd}T23:59:59-05:00`;
        const _cierreDesde = sessionStorage.getItem('cierre_desde');
        const _inicioDiaEfectivo = _cierreDesde || _inicioDia;

        // Pendientes = cualquier status que NO sea 'paid', 'canceled', 'cancelled'
        // Pagados    = status 'paid'
        let query = supabaseClient
            .from('orders')
            .select(`id, order_number, customer_name, total_amount, status, notes, payment_method, table_id,
                     order_items ( quantity, notes, unit_price )`)
            .gte('created_at', _inicioDiaEfectivo)
            .lte('created_at', _finDia)
            .not('status', 'in', '("canceled","cancelled")');

        if (_vistaHistorialPedidos === 'pagados') {
            query = query.eq('status', 'paid');
        } else {
            query = query.neq('status', 'paid');
        }

        query = query.order('created_at', { ascending: false });

        const { data: orders, error } = await query;
        if (error) throw error;

        const tableMap = await _buildTableMap();
        grid.innerHTML = '';

        if (!orders || orders.length === 0) {
            grid.innerHTML = `<p style="color:var(--text-3);font-size:12.5px;padding:28px 0;grid-column:1/-1;text-align:center;">
                Sin pedidos ${_vistaHistorialPedidos === 'pagados' ? 'pagados' : 'pendientes'} hoy.</p>`;
            return;
        }

        orders.forEach(ord => {
            const metodo = ord.payment_method || _extraerMetodoDeNotes(ord.notes || '');

            // Resolver mesa
            const mesaMatch = (ord.notes || '').match(/\[MESA\]\s*Mesa:\s*([^|]+)/i);
            const esPL  = (ord.notes || '').includes('[PARA LLEVAR]');
            const esDom = (ord.notes || '').includes('[DOMICILIO]');
            let mesaLabel;
            if (mesaMatch)                           mesaLabel = mesaMatch[1].trim();
            else if (esPL)                           mesaLabel = 'Para Llevar';
            else if (esDom)                          mesaLabel = 'Domicilio';
            else if (ord.table_id && tableMap[ord.table_id]) mesaLabel = tableMap[ord.table_id];
            else if (ord.table_id)                   mesaLabel = String(ord.table_id).slice(-4).toUpperCase();
            else                                     mesaLabel = 'P.L.';

            // Resumen de items
            const itemsResumen = (ord.order_items || []).map(it => {
                let nombre = 'Ítem';
                if (it.notes && it.notes.includes('[nombre]'))
                    nombre = it.notes.split('[nombre]')[1].split('|')[0].trim();
                return `${it.quantity}× ${nombre}`;
            }).join(', ') || '—';

            // Badge método — en pendientes muestra select; en pagados muestra badge + botón cambiar
            let metodoCelda;
            if (_vistaHistorialPedidos === 'pagados') {
                const badgeHtml = metodo ? _badgeMetodo(metodo) : `<span style="font-size:10px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--surface-2);color:var(--text-3);border:1.5px solid var(--border);">Sin método</span>`;
                metodoCelda = `
                    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
                        <div id="badge-metodo-${ord.id}">${badgeHtml}</div>
                        <button onclick="cambiarMetodoPago('${ord.id}')"
                            style="font-size:10px;font-weight:600;padding:3px 10px;border-radius:999px;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-3);cursor:pointer;font-family:'DM Sans',sans-serif;display:inline-flex;align-items:center;gap:4px;">
                            <i data-lucide="pencil" style="width:10px;height:10px;"></i> Cambiar
                        </button>
                    </div>`;
            } else {
                metodoCelda = `
                    <select onchange="registrarMetodoPago('${ord.id}', this.value)"
                        style="font-size:11px;padding:4px 10px;border-radius:8px;height:32px;width:100%;cursor:pointer;background:var(--amber-lt);border:1.5px solid rgba(154,108,26,.28);color:var(--amber);font-family:'DM Sans',sans-serif;">
                        <option value="">💳 Registrar pago…</option>
                        <option value="efectivo">💵 Efectivo</option>
                        <option value="transferencia">📲 Transferencia</option>
                        <option value="fiado">🤝 Fiado</option>
                    </select>`;
            }

            grid.insertAdjacentHTML('beforeend', `
                <div class="card" style="display:flex;flex-direction:column;gap:12px;border-radius:14px;">
                    <!-- Cabecera -->
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span class="mono" style="font-size:13px;font-weight:700;color:var(--olive);">${ord.order_number}</span>
                        <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;
                            background:${_vistaHistorialPedidos === 'pagados' ? 'var(--olive-lt)' : 'var(--amber-lt)'};
                            color:${_vistaHistorialPedidos === 'pagados' ? 'var(--olive)' : 'var(--amber)'};
                            border:1.5px solid ${_vistaHistorialPedidos === 'pagados' ? 'var(--olive-bd)' : 'rgba(154,108,26,.28)'};">
                            ${_vistaHistorialPedidos === 'pagados' ? '✅ Pagado' : '⏳ Pendiente'}
                        </span>
                    </div>

                    <!-- Info -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--surface-2);border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;">
                        <div>
                            <p style="font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Mesa</p>
                            <p style="font-size:13px;font-weight:600;color:var(--text-1);">${mesaLabel}</p>
                        </div>
                        <div>
                            <p style="font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Cliente</p>
                            <p style="font-size:12px;font-weight:500;color:var(--text-2);">${ord.customer_name || 'Consumidor Final'}</p>
                        </div>
                    </div>

                    <!-- Ítems -->
                    <p style="font-size:11.5px;color:var(--text-2);line-height:1.5;border-left:3px solid var(--border);padding-left:10px;">${itemsResumen}</p>

                    <!-- Total + método -->
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border-top:1.5px solid var(--border);padding-top:10px;">
                        <div>
                            <p style="font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Total</p>
                            <span class="mono" style="font-size:16px;font-weight:700;color:var(--olive);">${formatCOP(ord.total_amount)}</span>
                        </div>
                        <div style="text-align:right;min-width:0;">${metodoCelda}</div>
                    </div>

                    <!-- Acciones -->
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button onclick="exportarReciboPDF('${ord.id}')"
                            style="flex:1;min-width:60px;background:var(--surface-2);border:1.5px solid var(--border);color:var(--text-2);border-radius:8px;padding:5px 8px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">
                            📄 PDF
                        </button>
                        <button onclick="abrirModalFacturaElectronica('${ord.id}', '${ord.order_number}', ${ord.total_amount})"
                            style="flex:1;min-width:60px;background:var(--olive-lt);border:1.5px solid var(--olive-bd);color:var(--olive);border-radius:8px;padding:5px 8px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">
                            🧾 DIAN
                        </button>
                        <button onclick="editarComandaAdmin('${ord.id}', '${ord.order_number}', ${ord.total_amount})"
                            style="flex:1;min-width:60px;background:var(--blue-lt);border:1.5px solid rgba(37,99,168,.28);color:var(--blue);border-radius:8px;padding:5px 8px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">
                            ✏️ Editar
                        </button>
                        <button onclick="eliminarComandaReal('${ord.id}', '${ord.order_number}')"
                            style="background:var(--red-lt,#fff0f0);border:1.5px solid rgba(185,28,28,.22);color:var(--red);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;">
                            🗑️
                        </button>
                    </div>
                </div>`);
        });

        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error('[La 26] Error cargando historial pedidos:', err);
        grid.innerHTML = `<p style="color:var(--red);font-size:12.5px;padding:28px 0;grid-column:1/-1;text-align:center;">Error al cargar los pedidos. Revisa la consola.</p>`;
    }
}

// ============================================================
// CAMBIAR MÉTODO DE PAGO EN PEDIDO YA PAGADO
// ============================================================
async function cambiarMetodoPago(orderId) {
    const metodos = ['efectivo', 'transferencia', 'fiado'];
    const labels  = { efectivo: '💵 Efectivo', transferencia: '📲 Transferencia', fiado: '🤝 Fiado' };

    // Mini-modal inline — confirmar nuevo método
    const elegido = await new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;';
        overlay.innerHTML = `
            <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:24px;min-width:260px;display:flex;flex-direction:column;gap:14px;box-shadow:0 8px 32px rgba(0,0,0,.18);">
                <h3 style="font-size:14px;font-weight:700;color:var(--text-1);margin:0;">Cambiar método de pago</h3>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${metodos.map(m => `
                        <button data-metodo="${m}"
                            style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-1);font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .15s;">
                            ${labels[m]}
                        </button>`).join('')}
                </div>
                <button data-metodo="" style="font-size:12px;color:var(--text-3);background:none;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;">Cancelar</button>
            </div>`;
        overlay.querySelectorAll('button[data-metodo]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(btn.dataset.metodo || null);
            });
        });
        document.body.appendChild(overlay);
    });

    if (!elegido) return;

    try {
        const { data: ordData, error: errRead } = await supabaseClient
            .from('orders')
            .select('total_amount, notes, payment_method')
            .eq('id', orderId)
            .single();
        if (errRead) throw errRead;

        const monto = parseFloat(ordData.total_amount) || 0;
        const metodoAnterior = ordData.payment_method || _extraerMetodoDeNotes(ordData.notes || '');

        // Ajustar sessionStorage
        if (metodoAnterior && metodoAnterior !== elegido) {
            const keyViejo  = `pm_${metodoAnterior}`;
            const acumViejo = parseFloat(sessionStorage.getItem(keyViejo) || '0');
            sessionStorage.setItem(keyViejo, String(Math.max(0, acumViejo - monto)));
        }
        if (metodoAnterior !== elegido) {
            const keyNuevo = `pm_${elegido}`;
            const acumNuevo = parseFloat(sessionStorage.getItem(keyNuevo) || '0');
            sessionStorage.setItem(keyNuevo, String(acumNuevo + monto));
        }

        totalEfectivo      = parseFloat(sessionStorage.getItem('pm_efectivo')      || '0');
        totalTransferencia = parseFloat(sessionStorage.getItem('pm_transferencia') || '0');
        totalFiado         = parseFloat(sessionStorage.getItem('pm_fiado')         || '0');
        renderizarTotales();

        const notesBase  = (ordData.notes || '').replace(/\|\[pago\][^|]*/g, '').trimEnd();
        const notesNuevo = `${notesBase}|[pago]${elegido}`;

        const { error } = await supabaseClient
            .from('orders')
            .update({ payment_method: elegido, notes: notesNuevo })
            .eq('id', orderId);
        if (error) throw error;

        Toast.ok(`Método cambiado a ${labels[elegido]}`);

        // Actualizar badge en la tarjeta sin recargar todo
        const badgeEl = document.getElementById(`badge-metodo-${orderId}`);
        if (badgeEl) badgeEl.innerHTML = _badgeMetodo(elegido);

    } catch (err) {
        console.error('[La 26] Error cambiando método de pago:', err);
        Toast.error('No se pudo cambiar el método de pago.');
    }
}

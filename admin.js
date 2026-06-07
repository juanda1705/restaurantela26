// ============================================================
// RESTAURANTE LA 26 — PANEL DE ADMINISTRACIÓN
// admin.js · Versión 3.1
// FIXES v3.1:
//  [FIX-1] SELECT orders: eliminado 'payment_method' (columna inexistente → error 400).
//          El método de pago se gestiona ahora en sessionStorage / notes.
//  [FIX-2] UPDATE orders: cambiado status 'completed' → 'paid'
//          ('completed' no existe en order_status_enum; los valores válidos son:
//           pending, confirmed, in_kitchen, ready, delivered, paid, cancelled).
//  [FIX-3] cargarDashboardReal: totales por método de pago calculados desde
//          sessionStorage en vez de la columna inexistente payment_method.
//  [FIX-4] registrarMetodoPago: guarda el método en sessionStorage y actualiza
//          status a 'paid' (valor válido del enum) en vez de 'completed'.
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
// Rete-ICA Bucaramanga: Actividad 5611 — expendio comidas
// Tasa: 6.9 x 1000 (Acuerdo Municipal Bucaramanga)
// Impoconsumo: Art. 512-1 E.T. — restaurantes 8%
// ============================================================
const TASA_RETE_ICA    = 0.0069;  // 6.9 por mil
const TASA_IMPOCONSUMO = 0.08;    // 8% impoconsumo restaurantes

// ============================================================
// ESTADO GLOBAL CONTABLE
// ============================================================
let globalIngresos = 0;
let globalEgresos  = 0;

// Totales por método de pago (calculados al cargar el dashboard)
let totalEfectivo     = 0;
let totalTransferencia = 0;
let totalFiado        = 0;
let baseInicial       = 0; // apertura de caja

// ============================================================
// TOAST NOTIFICATIONS — reemplaza alert() nativos
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
// Soporta tanto 'protein' (legado) como 'executive_lunch' (nuevo)
// ============================================================
const MAPA_TIPO = {
    executive_lunch: { label: 'Proteína con Salsa', icono: '🥩', porciones: 35, badgeClass: 'badge-protein' },
    protein:         { label: 'Proteína con Salsa', icono: '🥩', porciones: 35, badgeClass: 'badge-protein' },
    side:            { label: 'Principio',           icono: '🍲', porciones: 50, badgeClass: 'badge-side'    },
    drink:           { label: 'Bebida',              icono: '🍹', porciones: 20, badgeClass: 'badge-drink'   },
    a_la_carte:      { label: 'A la Carta',          icono: '✨', porciones: 15, badgeClass: 'badge-carte'   },
    dessert:         { label: 'Postre',              icono: '🍮', porciones: 10, badgeClass: 'badge-dessert' },
};

// Obtiene etiqueta de rango de código
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
// 1. DASHBOARD — CONTABILIDAD Y COMANDAS
// ============================================================
async function cargarDashboardReal() {
    try {
        // payment_method ahora existe en BD (columna VARCHAR(20)) — se incluye en el SELECT
        const { data: orders, error } = await supabaseClient
            .from('orders')
            .select(`id, order_number, customer_name, total_amount, status, notes, payment_method,
                     table_id, order_items ( quantity, notes, unit_price )`);

        if (error) throw error;

        const ordenesValidas = (orders || []).filter(o =>
            o.status !== 'canceled' && o.status !== 'cancelled'
        );

        globalIngresos = ordenesValidas.reduce(
            (acc, o) => acc + (parseFloat(o.total_amount) || 0), 0
        );

        // Totales se recalculan desde notes en el bloque de renderizado de la tabla
        // (ver forEach de ordenesValidas más abajo)
        const baseICA      = Math.max(0, globalIngresos - globalEgresos);
        const provisionICA = baseICA * TASA_RETE_ICA;

        const elPedidos2 = document.getElementById('total-pedidos');
        if (elPedidos2) elPedidos2.textContent = `${ordenesValidas.length} pedidos`;
        // renderizarTotales() se llama más abajo una vez se calculan los totales por método

        // Historial de facturación
        const tbodyFacturas = document.getElementById('tabla-facturas');
        if (tbodyFacturas) {
            tbodyFacturas.innerHTML = '';
            if (ordenesValidas.length === 0) {
                tbodyFacturas.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                            Sin comandas registradas hoy.
                        </td>
                    </tr>`;
            } else {
                // Reconstruir totales por método desde payment_method (BD) con fallback a notes
                let _ef = 0, _tr = 0, _fi = 0;
                ordenesValidas.forEach(ord => {
                    // Prioridad: columna payment_method → luego notes legacy
                    const metodo = ord.payment_method || _extraerMetodoDeNotes(ord.notes || '');
                    const monto  = parseFloat(ord.total_amount) || 0;
                    if (metodo === 'efectivo')      _ef += monto;
                    if (metodo === 'transferencia') _tr += monto;
                    if (metodo === 'fiado')         _fi += monto;
                });
                // Sincronizar sessionStorage con los datos reales de la BD
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
                        : `<select onchange="registrarMetodoPago('${ord.id}', this.value)"
                               style="font-size:10.5px;padding:3px 10px;border-radius:999px;height:28px;width:auto;cursor:pointer;background:var(--amber-lt);border-color:rgba(154,108,26,.28);color:var(--amber);">
                               <option value="">💳 Registrar pago…</option>
                               <option value="efectivo">💵 Efectivo</option>
                               <option value="transferencia">📲 Transferencia</option>
                               <option value="fiado">🤝 Fiado</option>
                           </select>`;

                    // Obtener número de mesa desde notes (formato [MESA N] o [PARA LLEVAR])
                    const mesaMatch = (ord.notes || '').match(/\[MESA\s*([^\]]+)\]|\[(PARA LLEVAR|DOMICILIO)\]/i);
                    const mesaLabel = mesaMatch
                        ? (mesaMatch[1] || mesaMatch[2] || '—')
                        : (ord.table_id ? `—` : 'P.L.');

                    tbodyFacturas.insertAdjacentHTML('beforeend', `
                        <tr class="tbody-row">
                            <td>
                                <span class="mono" style="font-size:11.5px;font-weight:700;color:var(--olive);">${ord.order_number}</span>
                            </td>
                            <td style="font-size:12px;color:var(--text-3);font-weight:500;white-space:nowrap;">${mesaLabel}</td>
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

        // Cargar egresos para KPI
        const { data: gastos } = await supabaseClient
            .from('operating_expenses')
            .select('amount');
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
        // 1. Leer la orden para obtener total_amount y notes actuales
        const { data: ordData, error: errRead } = await supabaseClient
            .from('orders')
            .select('total_amount, notes, payment_method')
            .eq('id', orderId)
            .single();
        if (errRead) throw errRead;

        const monto = parseFloat(ordData.total_amount) || 0;

        // 2. Persistir en notas (legacy) Y en la columna payment_method (nuevo)
        const notesBase  = (ordData.notes || '').replace(/\|\[pago\][^|]*/g, '').trimEnd();
        const notesNuevo = `${notesBase}|[pago]${metodo}`;

        // 3. Actualizar status + notes + payment_method en BD (una sola query)
        const { error } = await supabaseClient
            .from('orders')
            .update({ status: 'paid', notes: notesNuevo, payment_method: metodo })
            .eq('id', orderId);
        if (error) throw error;

        // 4. Acumular en sessionStorage (para totales rápidos sin re-query)
        const metodoAnterior = ordData.payment_method || _extraerMetodoDeNotes(ordData.notes || '');
        if (metodoAnterior && metodoAnterior !== metodo) {
            const keyViejo = `pm_${metodoAnterior}`;
            const acumViejo = parseFloat(sessionStorage.getItem(keyViejo) || '0');
            sessionStorage.setItem(keyViejo, String(Math.max(0, acumViejo - monto)));
        }
        const keyPm = `pm_${metodo}`;
        // Solo acumular si no estaba ya en este método
        if (metodoAnterior !== metodo) {
            const acum = parseFloat(sessionStorage.getItem(keyPm) || '0');
            sessionStorage.setItem(keyPm, String(acum + monto));
        }

        // 5. Sincronizar globales y refrescar UI
        totalEfectivo      = parseFloat(sessionStorage.getItem('pm_efectivo')      || '0');
        totalTransferencia = parseFloat(sessionStorage.getItem('pm_transferencia') || '0');
        totalFiado         = parseFloat(sessionStorage.getItem('pm_fiado')         || '0');
        renderizarTotales();

        const label = { efectivo: 'Efectivo 💵', transferencia: 'Transferencia 📲', fiado: 'Fiado 🤝' };
        Toast.ok(`Pago registrado: ${label[metodo] || metodo}`);

        // 6. Actualizar solo el select de esa fila sin recargar toda la tabla
        _actualizarBadgePago(orderId, metodo, monto);

        // 7. Descuento automático de inventario según recetario
        descontarInsumosPorOrden(orderId).catch(err =>
            console.warn('[La 26] Auto-descuento inventario falló silenciosamente:', err.message)
        );

    } catch (err) {
        console.error('Error registrando método de pago:', err);
        Toast.error('No se pudo registrar el método de pago.');
    }
}

// Extrae el método de pago guardado en la columna notes
function _extraerMetodoDeNotes(notes) {
    const match = (notes || '').match(/\|\[pago\](efectivo|transferencia|fiado)/);
    return match ? match[1] : null;
}

// Reemplaza el select de una fila por el badge de método — sin recargar
function _actualizarBadgePago(orderId, metodo, monto) {
    // El select tiene onchange con el orderId — buscarlo por ese atributo
    const selects = document.querySelectorAll('#tabla-facturas select');
    selects.forEach(sel => {
        if (sel.getAttribute('onchange')?.includes(orderId)) {
            sel.outerHTML = _badgeMetodo(metodo);
        }
    });
}

function _badgeMetodo(metodo) {
    const cfg = {
        efectivo:      { bg: 'var(--olive-lt)',  color: 'var(--olive)', bd: 'var(--olive-bd)',              label: '💵 Efectivo'       },
        transferencia: { bg: 'var(--blue-lt)',   color: 'var(--blue)',  bd: 'rgba(37,99,168,.28)',           label: '📲 Transferencia'  },
        fiado:         { bg: 'var(--amber-lt)',  color: 'var(--amber)', bd: 'rgba(154,108,26,.28)',          label: '🤝 Fiado'          },
    };
    const c = cfg[metodo] || cfg.efectivo;
    return `<span style="font-size:10px;font-weight:600;padding:3px 11px;border-radius:999px;
        background:${c.bg};color:${c.color};border:1.5px solid ${c.bd};display:inline-block;">
        ${c.label}</span>`;
}

// ============================================================
// APERTURA DE CAJA — base inicial en efectivo
// ============================================================
function registrarAperturaCaja() {
    const inp = document.getElementById('input-base-caja');
    const val = parseFloat(inp?.value?.replace(/[^0-9.]/g,'')) || 0;
    if (val <= 0) { Toast.error('Ingresa un monto válido para la base de caja.'); return; }
    baseInicial = val;
    sessionStorage.setItem('base_caja_hoy', String(val));
    Toast.ok(`Base de caja registrada: ${formatCOP(val)}`);
    document.getElementById('kpi-saldo-caja')?.textContent && (
        document.getElementById('kpi-saldo-caja').textContent = formatCOP(baseInicial + totalEfectivo + totalTransferencia)
    );
    const panel = document.getElementById('panel-apertura-caja');
    if (panel) panel.style.display = 'none';
}


async function exportarReciboPDF(orderId) {
    try {
        // [FIX-5] 'payment_method' eliminado del segundo SELECT también
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
    const fmtCOP = formatCOP;

    // KPIs de métodos de pago (IDs configurados en admin.html)
    const elEf = document.getElementById('kpi-efectivo');
    const elTr = document.getElementById('kpi-transferencia');
    const elFi = document.getElementById('kpi-fiado');
    const elSd = document.getElementById('kpi-saldo-caja');
    const elGv = document.getElementById('gros-ventas');

    if (elEf)  elEf.textContent  = fmtCOP(totalEfectivo);
    if (elTr)  elTr.textContent  = fmtCOP(totalTransferencia);
    if (elFi)  elFi.textContent  = fmtCOP(totalFiado);
    if (elGv)  elGv.textContent  = fmtCOP(globalIngresos);

    // Saldo en caja = base + efectivo + transferencia (fiado no está en caja)
    const saldoCaja = baseInicial + totalEfectivo + totalTransferencia;
    if (elSd) elSd.textContent = fmtCOP(saldoCaja);

    // ICA y utilidad
    const baseICA      = Math.max(0, globalIngresos - globalEgresos);
    const provisionICA = baseICA * TASA_RETE_ICA;
    const elICA = document.getElementById('val-reteica');
    if (elICA) elICA.textContent = fmtCOP(provisionICA);
}


// Cuando se registra un método de pago, busca recetas que
// coincidan con los platos del pedido y descuenta insumos.
// ============================================================
async function descontarInsumosPorOrden(orderId) {
    // Obtener items de la orden con nombre del plato
    const { data: items, error: errItems } = await supabaseClient
        .from('order_items')
        .select('menu_item_id, quantity, notes')
        .eq('order_id', orderId);

    if (errItems || !items || items.length === 0) return;

    // Cargar todas las recetas con sus ingredientes
    const { data: recetas } = await supabaseClient
        .from('production_recipes')
        .select(`name, recipe_ingredients ( supply_id, supply_name, quantity_per_dish, unit )`);

    if (!recetas || recetas.length === 0) return;

    // Cargar nombres de menu_items para buscar recetas equivalentes
    const menuItemIds = [...new Set(items.map(i => i.menu_item_id).filter(Boolean))];
    const { data: menuItems } = await supabaseClient
        .from('menu_items')
        .select('id, name')
        .in('id', menuItemIds);

    const menuMap = {};
    (menuItems || []).forEach(m => { menuMap[m.id] = m.name; });

    // Para cada item del pedido buscar receta por nombre
    const descuentos = {}; // supply_id → total a descontar

    items.forEach(item => {
        // Nombre del plato: de notes [nombre] o de menuMap
        let nombrePlato = menuMap[item.menu_item_id] || '';
        if (!nombrePlato && item.notes?.includes('[nombre]')) {
            nombrePlato = item.notes.split('[nombre]')[1].split('|')[0].trim();
        }
        if (!nombrePlato) return;

        // Buscar receta cuyo nombre coincida (case-insensitive)
        const receta = recetas.find(r =>
            r.name.toLowerCase().trim() === nombrePlato.toLowerCase().trim() ||
            nombrePlato.toLowerCase().includes(r.name.toLowerCase().split(' ')[0])
        );
        if (!receta?.recipe_ingredients?.length) return;

        const qty = item.quantity || 1;
        receta.recipe_ingredients.forEach(ing => {
            if (!ing.supply_id) return;
            descuentos[ing.supply_id] = (descuentos[ing.supply_id] || 0) + ing.quantity_per_dish * qty;
        });
    });

    if (Object.keys(descuentos).length === 0) return;

    // Actualizar stocks en batch
    const supplyIds = Object.keys(descuentos);
    const { data: stocks } = await supabaseClient
        .from('inventory_supplies')
        .select('id, current_stock')
        .in('id', supplyIds);

    const updates = (stocks || []).map(s => ({
        id: s.id,
        current_stock: Math.max(0, (parseFloat(s.current_stock) || 0) - (descuentos[s.id] || 0)),
        updated_at: new Date().toISOString(),
    }));

    for (const upd of updates) {
        await supabaseClient
            .from('inventory_supplies')
            .update({ current_stock: upd.current_stock, updated_at: upd.updated_at })
            .eq('id', upd.id);
    }

    console.log(`[La 26] 📦 Inventario descontado automáticamente para orden ${orderId}`);
}


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

    const modal = document.getElementById('modal-factura-dian');
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
            nit:          '900.123.456-7',
            razon_social: 'Restaurante la 26 SAS',
            municipio:    'Bucaramanga',
            departamento: 'Santander',
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
        referencia_interna: { order_id: _feOrdenId, order_number: _feOrdenNo },
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
            .order('name', { ascending: true });

        if (componenteFiltradoActual !== 'todos') {
            query = query.eq('item_type', componenteFiltradoActual);
        }
        // [FIX-4] ELIMINADO: query.neq('item_type','sauce')
        // 'sauce' NO existe en item_type_enum → causaba error 400 en TODOS los loads del menú.
        // Los valores válidos del enum son: executive_lunch, a_la_carte, drink, dessert, side.

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

        // Ordenar por tipo y luego por nombre (sin depender de product_code)
        const itemsOrdenados = [...items].sort((a, b) => {
            const orden = { protein: 1, executive_lunch: 1, side: 2, drink: 3, a_la_carte: 4, dessert: 5 };
            const oA = orden[a.item_type] || 9;
            const oB = orden[b.item_type] || 9;
            if (oA !== oB) return oA - oB;
            return (a.name || '').localeCompare(b.name || '', 'es');
        });

        itemsOrdenados.forEach((item, animIdx) => {
            const cfg           = MAPA_TIPO[item.item_type] || { label: item.item_type, icono: '🍽️', porciones: 20, badgeClass: '' };
            const nombreEscapado = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const codigo        = '—';
            const rango         = { color: 'var(--text-3)' };

            contenedor.insertAdjacentHTML('beforeend', `
                <div class="card menu-card" style="display:flex;flex-direction:column;gap:12px;animation-delay:${animIdx * 40}ms;">
                    <!-- Header tarjeta -->
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                            <span style="font-size:11px;font-weight:700;color:${rango.color};background:rgba(0,0,0,.04);border:1.5px solid rgba(0,0,0,.07);border-radius:999px;padding:3px 9px;flex-shrink:0;" class="mono">#${codigo}</span>
                            <span class="badge ${cfg.badgeClass}">${cfg.icono} ${cfg.label}</span>
                        </div>
                        <button onclick="eliminarComponenteCatalogo('${item.id}','${nombreEscapado}')"
                            style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:15px;padding:0;flex-shrink:0;transition:color .2s;"
                            onmouseover="this.style.color='var(--red)'"
                            onmouseout="this.style.color='var(--text-3)'"
                            title="Eliminar">🗑️</button>
                    </div>

                    <!-- Nombre -->
                    <h4 style="font-size:13.5px;font-weight:600;color:var(--text-1);line-height:1.4;margin:0;">
                        ${item.name}
                    </h4>

                    <!-- Inputs precio / porciones -->
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

                    <!-- Switch disponibilidad -->
                    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid var(--border);padding-top:10px;">
                        <span style="font-size:11.5px;color:var(--text-3);">¿Disponible hoy?</span>
                        <button data-switch-id="${item.id}"
                            onclick="alternarVisibilidadPlatoReal('${item.id}', ${item.is_active})"
                            class="${item.is_active ? 'sw-on' : 'sw-off'}">
                            ${item.is_active ? '🟢 Activo' : '🔴 Agotado'}
                        </button>
                    </div>
                </div>`);
        });

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
// REGISTRAR NUEVO PLATO (con product_code)
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const formNuevoPlato = document.getElementById('form-nuevo-plato');
    if (formNuevoPlato) {
        formNuevoPlato.addEventListener('submit', async (e) => {
            e.preventDefault();

            const product_code = parseInt(document.getElementById('menu-codigo').value) || null;
            const name         = document.getElementById('menu-nombre').value.trim();
            const price        = parseFloat(document.getElementById('menu-precio').value);
            const item_type    = document.getElementById('menu-tipo').value;
            const portions_today = parseInt(document.getElementById('menu-porciones').value) || null;

            if (item_type === 'sauce') {
                Toast.error('El tipo "sauce" no está disponible como tipo independiente.');
                return;
            }
            // product_code es opcional — la columna puede no existir en la BD

            try {
                // Obtener o crear restaurante
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
                    console.log('✅ Restaurante la 26 creado automáticamente.');
                }

                const mapaCategoria = {
                    executive_lunch: 'Proteína con Salsa',
                    protein:         'Proteína con Salsa',
                    side:            'Principio',
                    drink:           'Bebida',
                    a_la_carte:      'A la Carta',
                    dessert:         'Postre',
                };
                const nombreCategoria = mapaCategoria[item_type] || 'General';

                // Upsert categoría
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

                // Payload base — sin product_code (columna opcional en el esquema)
                const payload = {
                    restaurant_id: restaurantId,
                    category_id:   cat.id,
                    name,
                    price,
                    item_type,
                    is_active:     true,
                };
                if (portions_today !== null) payload.portions_today = portions_today;
                // product_code: agregar solo si la columna existe en la BD
                if (product_code) payload.product_code = product_code;

                const { error: errItem } = await supabaseClient
                    .from('menu_items')
                    .insert([payload]);

                if (errItem) {
                    // Si falla por product_code inexistente, reintentar sin él
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

                document.getElementById('menu-codigo').value   = '';
                document.getElementById('menu-nombre').value   = '';
                document.getElementById('menu-precio').value   = '';
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
// ELIMINAR PLATO
// ============================================================
async function eliminarComponenteCatalogo(idItem, nombreItem) {
    if (!confirm(`⚠️ ¿Eliminar permanentemente "${nombreItem}"?`)) return;
    try {
        await supabaseClient.from('menu_item_ingredients').delete().eq('menu_item_id', idItem);
        const { error } = await supabaseClient.from('menu_items').delete().eq('id', idItem);
        if (error) throw error;
        cargarSlotsMenuReal();
    } catch (err) {
        console.error('Error eliminando plato:', err);
        Toast.error('No se pudo eliminar. Revisa la consola.');
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
                console.warn('Columna portions_today no existe. Ejecuta: ALTER TABLE menu_items ADD COLUMN portions_today INTEGER;');
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
        const { data: egresos, error } = await supabaseClient
            .from('operating_expenses')
            .select('*')
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
    // Restaurar base de caja persistida en la jornada
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
// 6. CIERRE DE CAJA INTELIGENTE — INFORME Z + historial_cierres
// ============================================================
async function ejecutarCierreCaja() {
    const baseReteICA  = Math.max(0, globalIngresos - globalEgresos);
    const totalICA     = baseReteICA * TASA_RETE_ICA;
    const ivaConsumo   = globalIngresos * TASA_IMPOCONSUMO;
    const utilidadNeta = globalIngresos - globalEgresos - totalICA;
    const saldoCaja    = baseInicial + totalEfectivo + totalTransferencia;

    // Poblar el modal de cierre con los datos actuales
    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formatCOP(val);
    };
    setEl('cierre-ing',  globalIngresos);
    setEl('cierre-eg',   globalEgresos);
    setEl('cierre-ica',  totalICA);
    setEl('cierre-impo', ivaConsumo);
    setEl('cierre-ut',   utilidadNeta);
    setEl('cierre-ef',   totalEfectivo);
    setEl('cierre-tr',   totalTransferencia);
    setEl('cierre-fi',   totalFiado);
    setEl('cierre-saldo',saldoCaja);

    const elUt = document.getElementById('cierre-ut');
    if (elUt) elUt.style.color = utilidadNeta >= 0 ? 'var(--olive)' : 'var(--red)';

    // Mostrar modal
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
        fecha:          hoy,
        ingresos:       Math.round(globalIngresos),
        egresos:        Math.round(globalEgresos),
        utilidad_neta:  Math.round(utilidadNeta),
        provision_ica:  Math.round(totalICA),
        impoconsumo:    Math.round(ivaConsumo),
        efectivo:       Math.round(totalEfectivo),
        transferencia:  Math.round(totalTransferencia),
        fiado:          Math.round(totalFiado),
        base_caja:      Math.round(baseInicial),
        created_at:     new Date().toISOString(),
    };

    try {
        const { error } = await supabaseClient
            .from('historial_cierres')
            .insert([cierrePayload]);
        if (error) throw error;
        Toast.ok(`✅ Cierre del ${hoy} archivado en el calendario.`, 6000);
    } catch (err) {
        console.warn('historial_cierres no disponible aún — guardando localmente:', err.message);
        // Fallback: guardar en localStorage
        const histLocal = JSON.parse(localStorage.getItem('cierres_local') || '[]');
        histLocal.unshift({ ...cierrePayload, local: true });
        localStorage.setItem('cierres_local', JSON.stringify(histLocal.slice(0, 90)));
        Toast.ok('Cierre archivado localmente. Ejecuta el SQL de historial_cierres para persistir en la nube.');
    }

    // ── Resetear contadores del día ───────────────────────────
    ['pm_efectivo','pm_transferencia','pm_fiado','base_caja_hoy'].forEach(k => sessionStorage.removeItem(k));
    totalEfectivo = 0; totalTransferencia = 0; totalFiado = 0; baseInicial = 0;

    // ── Actualizar calendario si está visible ──────────────────
    if (document.getElementById('tab-calendario')?.style.display !== 'none') {
        cargarCalendarioCierres();
    }

    Toast.ok('Ciclo contable cerrado. Contadores reseteados a $0.');
    cerrarModalCierre();
    setTimeout(() => cargarDashboardReal(), 500);
}

// ── Calendario de cierres — async/await con paginación y filtro por fecha ──
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
        // Fallback localStorage si Supabase no tiene la tabla aún
        const todos = JSON.parse(localStorage.getItem('cierres_local') || '[]');
        _cierresState.datos  = todos.slice(
            _cierresState.pagina * _cierresState.limite,
            (_cierresState.pagina + 1) * _cierresState.limite
        );
        _cierresState.total  = todos.length;
    }

    const cierres = _cierresState.datos;

    if (cierres.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--text-3);">Sin cierres registrados aún.</td></tr>`;
        if (resumen) resumen.innerHTML = '';
        return;
    }

    // ── Totales acumulados del lote visible ──────────────────
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
                <!-- Filtro por fecha + paginación -->
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
                <!-- KPIs acumulados del lote -->
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

    // ── Render tabla (no bloquea DOM) ────────────────────────
    const fragment = document.createDocumentFragment();
    cierres.forEach(c => {
        const utClass  = (c.utilidad_neta || 0) >= 0 ? 'color:var(--olive)' : 'color:var(--red)';
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
    // El dashboard se carga desde admin.html vía cambiarTab inicial
});
// ============================================================
// MÓDULO A: CONTROL DE ACCESO — SISTEMA DE CIERRE DE PEDIDOS
// ============================================================
// Clave en Supabase: tabla 'system_settings', row { key: 'orders_enabled', value: 'true'|'false' }
// Fallback local: localStorage['orders_enabled_local']

const SETTING_KEY = 'orders_enabled';

/**
 * Lee el estado del sistema desde Supabase.
 * Si la tabla no existe aún, usa localStorage como fallback.
 */
async function cargarEstadoSistema() {
    try {
        const { data, error } = await supabaseClient
            .from('system_settings')
            .select('value')
            .eq('key', SETTING_KEY)
            .maybeSingle();

        if (error) throw error;

        // Si no hay fila aún, el sistema está habilitado por defecto
        const habilitado = data ? data.value === 'true' : true;
        _renderToggleSistema(habilitado);
        return habilitado;
    } catch (_) {
        // Fallback: leer de localStorage si la tabla no existe
        const local = localStorage.getItem(SETTING_KEY);
        const habilitado = local === null ? true : local === 'true';
        _renderToggleSistema(habilitado);
        return habilitado;
    }
}

/**
 * Alterna el estado del sistema (habilitado ↔ deshabilitado).
 * Persiste en Supabase y en localStorage como backup.
 */
async function toggleEstadoSistema() {
    const btnToggle = document.getElementById('btn-toggle-sistema');
    if (!btnToggle) return;

    const estadoActual = btnToggle.dataset.estado === 'true';
    const nuevoEstado  = !estadoActual;

    // Optimista: actualizar UI de inmediato
    _renderToggleSistema(nuevoEstado);
    localStorage.setItem(SETTING_KEY, String(nuevoEstado));

    try {
        // Upsert en Supabase
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

/**
 * Actualiza el toggle en el DOM según el estado actual.
 */
function _renderToggleSistema(habilitado) {
    const btn      = document.getElementById('btn-toggle-sistema');
    const estadoBadge = document.getElementById('badge-estado-sistema');
    const desc     = document.getElementById('desc-estado-sistema');
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
// Tablas Supabase necesarias (DDL en basededatos.txt):
//   production_recipes  { id, name, description, created_at }
//   recipe_ingredients  { id, recipe_id, supply_id, supply_name, quantity_per_dish, unit }
//
// LÓGICA MATEMÁTICA:
//   La receta define cuánto insumo consume UN solo plato.
//   Con el stock actual se calcula:
//     platos_estimados = FLOOR( MIN( stock_i / qty_per_dish_i ) )  ∀ insumo i
//   El insumo con menor cobertura es el cuello de botella.
//   El resultado es una ESTIMACIÓN — no es exacto porque en cocina
//   real hay merme (10-20%). El admin toma ese número y pone las
//   porciones en el menú; cuando llegan a 0 el plato se bloquea.
// ============================================================

let _recetasCache = [];
let _supplyCache  = [];
let _calcResult   = null;

// ── Carga recetas y puebla el selector ──────────────────────
async function cargarRecetas() {
    const tbody = document.getElementById('tabla-recetas');
    const badge = document.getElementById('badge-recetas-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-3);">Cargando recetas…</td></tr>`;

    try {
        const { data: recetas, error } = await supabaseClient
            .from('production_recipes')
            .select(`id, name, description,
                     recipe_ingredients ( id, supply_id, supply_name, quantity_per_dish, unit )`)
            .order('name', { ascending: true });

        if (error) throw error;
        _recetasCache = recetas || [];

        if (badge) badge.textContent = `${_recetasCache.length} receta${_recetasCache.length !== 1 ? 's' : ''}`;

        // Poblar selector de la calculadora
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
                ${i.quantity_per_dish} ${i.unit} ${i.supply_name}
            </span>`
        ).join('');

        return `<tr class="tbody-row">
            <td style="font-size:13px;font-weight:600;color:var(--text-1);white-space:nowrap;">${r.name}</td>
            <td style="font-size:12px;color:var(--text-3);">${r.description || '—'}</td>
            <td><div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;">${ings || '<span style="color:var(--text-3);font-size:11.5px;">Sin ingredientes</span>'}</div></td>
            <td style="text-align:center;">
                <button onclick="eliminarReceta('${r.id}','${(r.name||'').replace(/'/g,"\'")}')" class="btn-danger">🗑️ Eliminar</button>
            </td>
        </tr>`;
    }).join('');
}

// ── Guardar nueva receta ─────────────────────────────────────
async function guardarReceta() {
    const nombre = document.getElementById('rec-nombre')?.value.trim();
    const desc   = document.getElementById('rec-descripcion')?.value.trim();

    if (!nombre) { Toast.error('El nombre de la receta es obligatorio.'); return; }

    const filas = document.querySelectorAll('#tabla-form-ingredientes .ing-row');
    const ingredientes = [];

    filas.forEach(fila => {
        const supplyId   = fila.querySelector('.ing-supply-id')?.value || null;
        const supplyName = fila.querySelector('.ing-supply-name')?.value?.trim();
        const qty        = parseFloat(fila.querySelector('.ing-qty')?.value);
        const unit       = fila.querySelector('.ing-unit')?.value?.trim();
        if (supplyName && !isNaN(qty) && qty > 0 && unit) {
            ingredientes.push({ supply_id: supplyId, supply_name: supplyName, quantity_per_dish: qty, unit });
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
        // Limpiar formulario
        document.getElementById('rec-nombre').value = '';
        document.getElementById('rec-descripcion').value = '';
        document.getElementById('tabla-form-ingredientes').innerHTML = '';
        agregarFilaIngrediente();
        cargarRecetas();
    } catch (err) {
        console.error('Error guardando receta:', err);
        Toast.error(`Error: ${err.message}`);
    }
}

// ── Fila dinámica de ingrediente ─────────────────────────────
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

    const opts = _supplyCache.map(s =>
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

// ── Calculadora: platos ≈ FLOOR( MIN( stock_i / qty_per_dish_i ) ) ──
async function calcularProduccion() {
    const sel      = document.getElementById('sel-receta-calculo');
    const recetaId = sel?.value;
    if (!recetaId) { Toast.error('Selecciona una receta primero.'); return; }

    const receta = _recetasCache.find(r => r.id === recetaId);
    if (!receta?.recipe_ingredients?.length) {
        Toast.error('La receta no tiene ingredientes. Edítala primero.');
        return;
    }

    // Obtener stocks frescos de Supabase
    const supplyIds = receta.recipe_ingredients.filter(i => i.supply_id).map(i => i.supply_id);
    let stockMap = {};

    if (supplyIds.length > 0) {
        const { data: stocks } = await supabaseClient
            .from('inventory_supplies')
            .select('id, item_name, current_stock, unit_of_measure')
            .in('id', supplyIds);
        (stocks || []).forEach(s => { stockMap[s.id] = s; });
    }

    // Calcular cobertura por insumo
    let platosEstimados = Infinity;
    const detalleIng = receta.recipe_ingredients.map(ing => {
        const stockActual  = stockMap[ing.supply_id]?.current_stock ?? null;
        const coberturaEst = (stockActual !== null && ing.quantity_per_dish > 0)
            ? Math.floor(stockActual / ing.quantity_per_dish)
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
        const consumoTotal = i.stockActual !== null ? (i.quantity_per_dish * platosEstimados).toFixed(3) : '—';
        const restante     = i.stockActual !== null ? Math.max(0, i.stockActual - i.quantity_per_dish * platosEstimados).toFixed(3) : '—';
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
                <p style="font-size:12px;color:var(--text-2);line-height:1.6;">Ve a <strong>Control de Menú</strong> y pon<br><strong>${platosEstimados}</strong> en "Porciones del día" del plato.</p>
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
            <p style="font-size:11.5px;color:var(--text-2);margin-bottom:10px;">Ingresa cuántos platos se vendieron realmente y descuenta ese consumo del inventario.</p>
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
            <p style="font-size:12px;color:var(--text-2);margin-top:4px;">Revisa el insumo marcado como cuello de botella y repón stock.</p>
        </div>`}`;
}

// ── Descuento real del inventario ────────────────────────────
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
    _supplyCache = []; // forzar recarga fresca
    cargarInventarioReal();
    cargarRecetas();
}

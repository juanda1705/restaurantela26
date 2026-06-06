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
        // [FIX-1] 'payment_method' eliminado — columna no existe en orders → causaba error 400
        const { data: orders, error } = await supabaseClient
            .from('orders')
            .select(`id, order_number, customer_name, total_amount, status, notes,
                     order_items ( quantity, notes, unit_price )`);

        if (error) throw error;

        const ordenesValidas = (orders || []).filter(o =>
            o.status !== 'canceled' && o.status !== 'cancelled'
        );

        globalIngresos = ordenesValidas.reduce(
            (acc, o) => acc + (parseFloat(o.total_amount) || 0), 0
        );

        // [FIX-1b] Totales por método de pago leídos desde sessionStorage
        // (payment_method no existe como columna; se guarda localmente al registrar el pago)
        totalEfectivo      = parseFloat(sessionStorage.getItem('pm_efectivo')      || '0');
        totalTransferencia = parseFloat(sessionStorage.getItem('pm_transferencia') || '0');
        totalFiado         = parseFloat(sessionStorage.getItem('pm_fiado')         || '0');

        const baseICA      = Math.max(0, globalIngresos - globalEgresos);
        const provisionICA = baseICA * TASA_RETE_ICA;

        document.getElementById('gros-ventas')   ?.textContent && (document.getElementById('gros-ventas').textContent   = formatCOP(globalIngresos));
        document.getElementById('total-pedidos') ?.textContent && (document.getElementById('total-pedidos').textContent = `${ordenesValidas.length} pedidos`);
        document.getElementById('val-reteica')   ?.textContent && (document.getElementById('val-reteica').textContent   = formatCOP(provisionICA));

        // Actualizar panel de métodos de pago
        const elEf = document.getElementById('kpi-efectivo');
        const elTr = document.getElementById('kpi-transferencia');
        const elFi = document.getElementById('kpi-fiado');
        const elSaldo = document.getElementById('kpi-saldo-caja');
        if (elEf)    elEf.textContent    = formatCOP(totalEfectivo);
        if (elTr)    elTr.textContent    = formatCOP(totalTransferencia);
        if (elFi)    elFi.textContent    = formatCOP(totalFiado);
        if (elSaldo) elSaldo.textContent = formatCOP(baseInicial + totalEfectivo + totalTransferencia);

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
                ordenesValidas.forEach(ord => {
                    const metodo = ''; // payment_method no existe en BD; se muestra botón siempre
                    const badgeMetodo = metodo
                        ? `<span style="font-size:10px;font-weight:600;padding:2px 9px;border-radius:999px;
                            background:${metodo==='efectivo'?'var(--olive-lt)':metodo==='transferencia'?'var(--blue-lt)':'var(--amber-lt)'};
                            color:${metodo==='efectivo'?'var(--olive)':metodo==='transferencia'?'var(--blue)':'var(--amber)'};
                            border:1.5px solid ${metodo==='efectivo'?'var(--olive-bd)':metodo==='transferencia'?'rgba(37,99,168,.28)':'rgba(154,108,26,.28)'};">
                            ${metodo==='efectivo'?'💵 Efectivo':metodo==='transferencia'?'📲 Transferencia':'🤝 Fiado'}
                           </span>`
                        : `<select onchange="registrarMetodoPago('${ord.id}', this.value)"
                               style="font-size:10.5px;padding:3px 10px;border-radius:999px;height:28px;width:auto;cursor:pointer;background:var(--amber-lt);border-color:rgba(154,108,26,.28);color:var(--amber);">
                               <option value="">💳 Registrar pago…</option>
                               <option value="efectivo">💵 Efectivo</option>
                               <option value="transferencia">📲 Transferencia</option>
                               <option value="fiado">🤝 Fiado</option>
                           </select>`;

                    tbodyFacturas.insertAdjacentHTML('beforeend', `
                        <tr class="tbody-row">
                            <td>
                                <span class="mono" style="font-size:11.5px;font-weight:700;color:var(--olive);">${ord.order_number}</span>
                            </td>
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
        // [FIX-2] status 'completed' NO existe en order_status_enum → se usa 'paid'
        // [FIX-3] payment_method guardado en sessionStorage (columna no existe en BD)
        const { error } = await supabaseClient
            .from('orders')
            .update({ status: 'paid' })
            .eq('id', orderId);
        if (error) throw error;
        // Acumular en sessionStorage por método
        const monto = parseFloat(sessionStorage.getItem(`order_total_${orderId}`) || '0');
        const keyPm = `pm_${metodo}`;
        const acum  = parseFloat(sessionStorage.getItem(keyPm) || '0');
        sessionStorage.setItem(keyPm, String(acum + monto));
        if (error) throw error;
        const label = { efectivo: 'Efectivo 💵', transferencia: 'Transferencia 📲', fiado: 'Fiado 🤝' };
        Toast.ok(`Pago registrado: ${label[metodo] || metodo}`);
        cargarDashboardReal();
    } catch (err) {
        console.error('Error registrando método de pago:', err);
        Toast.error('No se pudo registrar el método de pago.');
    }
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
// 2. MODAL FACTURA ELECTRÓNICA DIAN (desde Dashboard)
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
// 6. CIERRE DE CAJA DIARIO — INFORME Z
// ============================================================
function ejecutarCierreCaja() {
    const baseReteICA  = Math.max(0, globalIngresos - globalEgresos);
    const totalICA     = baseReteICA * TASA_RETE_ICA;
    const ivaConsumo   = globalIngresos * TASA_IMPOCONSUMO;
    const utilidadNeta = globalIngresos - globalEgresos - totalICA;

    const msg = `
══════ CIERRE DE CAJA — INFORME Z ══════
Restaurante la 26 · Bucaramanga, Santander

(+) Ingresos Brutos:          ${formatCOP(globalIngresos)}
(-) Gastos y Nómina:          ${formatCOP(globalEgresos)}
(-) Provisión Rete-ICA 6.9‰:  ${formatCOP(totalICA)}
    Base: ingresos - egresos = ${formatCOP(baseReteICA)}
(ref) Impoconsumo 8%:         ${formatCOP(ivaConsumo)}
════════════════════════════════════════
(=) UTILIDAD NETA ESTIMADA:   ${formatCOP(utilidadNeta)}
════════════════════════════════════════

¿Cerrar y validar el flujo de caja de este ciclo?`;

    if (confirm(msg)) {
        Toast.ok('Ciclo contable cerrado. Reporte archivado.');
    }
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
// Tablas Supabase:
//   production_recipes   { id, name, description, yield_portions, created_at }
//   recipe_ingredients   { id, recipe_id, supply_id, supply_name, quantity_required, unit }
//
// Lógica matemática:
//   platos_posibles = FLOOR( MIN( stock_i / cantidad_requerida_i ) )  para todos los insumos i de la receta
//   Al marcar N "platos vendidos":
//       new_stock_i = stock_i - (cantidad_requerida_i * N)

let _recetasCache  = [];
let _supplyCache   = [];
let _calcResult    = null; // { recetaId, platosMaximos, ingredientes[] }

/**
 * Carga recetas desde Supabase y renderiza la tabla.
 */
async function cargarRecetas() {
    const tbody = document.getElementById('tabla-recetas');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-3);">Cargando recetas...</td></tr>`;

    try {
        const { data: recetas, error } = await supabaseClient
            .from('production_recipes')
            .select(`id, name, description, yield_portions,
                     recipe_ingredients ( id, supply_id, supply_name, quantity_required, unit )`)
            .order('name', { ascending: true });

        if (error) throw error;
        _recetasCache = recetas || [];
        _renderTablaRecetas();

        // Poblar selector de receta para el calculador
        const sel = document.getElementById('sel-receta-calculo');
        if (sel) {
            sel.innerHTML = '<option value="">— Seleccionar receta base —</option>';
            _recetasCache.forEach(r => {
                sel.insertAdjacentHTML('beforeend', `<option value="${r.id}">${r.name} (rinde ${r.yield_portions} platos/ciclo)</option>`);
            });
        }
    } catch (err) {
        console.error('Error cargando recetas:', err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--red);font-size:12.5px;">Error al cargar recetas. Revisa la consola.</td></tr>`;
    }
}

function _renderTablaRecetas() {
    const tbody = document.getElementById('tabla-recetas');
    if (!tbody) return;
    if (_recetasCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">No hay recetas registradas.</td></tr>`;
        return;
    }
    tbody.innerHTML = _recetasCache.map(r => {
        const ings = (r.recipe_ingredients || [])
            .map(i => `<span style="background:var(--olive-lt);border:1px solid var(--olive-bd);color:var(--olive);border-radius:999px;padding:1px 8px;font-size:10.5px;font-weight:600;">${i.quantity_required} ${i.unit} ${i.supply_name}</span>`)
            .join(' ');
        return `<tr class="tbody-row">
            <td style="font-size:13px;font-weight:600;color:var(--text-1);">${r.name}</td>
            <td style="font-size:12px;color:var(--text-3);">${r.description || '—'}</td>
            <td style="text-align:center;"><span class="mono" style="font-size:13px;font-weight:700;color:var(--olive);">${r.yield_portions}</span></td>
            <td style="max-width:280px;"><div style="display:flex;flex-wrap:wrap;gap:4px;">${ings || '<span style="color:var(--text-3);font-size:11.5px;">Sin ingredientes</span>'}</div></td>
            <td style="text-align:center;">
                <button onclick="eliminarReceta('${r.id}','${(r.name||'').replace(/'/g,"\\'")}') " class="btn-danger">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

/**
 * Registra una nueva receta base con sus ingredientes.
 * La UI pasa el objeto mediante el formulario dinámico.
 */
async function guardarReceta() {
    const nombre    = document.getElementById('rec-nombre')?.value.trim();
    const desc      = document.getElementById('rec-descripcion')?.value.trim();
    const porciones = parseInt(document.getElementById('rec-porciones')?.value) || 1;

    if (!nombre) { Toast.error('El nombre de la receta es obligatorio.'); return; }

    // Leer ingredientes del constructor dinámico
    const filas = document.querySelectorAll('#tabla-form-ingredientes .ing-row');
    const ingredientes = [];
    let valido = true;

    filas.forEach(fila => {
        const supplyId   = fila.querySelector('.ing-supply-id')?.value;
        const supplyName = fila.querySelector('.ing-supply-name')?.value?.trim();
        const qty        = parseFloat(fila.querySelector('.ing-qty')?.value);
        const unit       = fila.querySelector('.ing-unit')?.value?.trim();
        if (!supplyName || isNaN(qty) || qty <= 0 || !unit) { valido = false; return; }
        ingredientes.push({ supply_id: supplyId || null, supply_name: supplyName, quantity_required: qty, unit });
    });

    if (!valido || ingredientes.length === 0) {
        Toast.error('Agrega al menos un ingrediente válido (nombre, cantidad y unidad).');
        return;
    }

    try {
        const { data: receta, error: errR } = await supabaseClient
            .from('production_recipes')
            .insert([{ name: nombre, description: desc, yield_portions: porciones }])
            .select('id')
            .single();
        if (errR) throw errR;

        const ingsPayload = ingredientes.map(i => ({ ...i, recipe_id: receta.id }));
        const { error: errI } = await supabaseClient
            .from('recipe_ingredients')
            .insert(ingsPayload);
        if (errI) throw errI;

        Toast.ok(`Receta "${nombre}" guardada correctamente.`);
        _resetFormReceta();
        cargarRecetas();
    } catch (err) {
        console.error('Error guardando receta:', err);
        Toast.error(`Error al guardar: ${err.message}`);
    }
}

function _resetFormReceta() {
    ['rec-nombre','rec-descripcion','rec-porciones'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const tbody = document.getElementById('tabla-form-ingredientes');
    if (tbody) tbody.innerHTML = '';
    agregarFilaIngrediente(); // Deja una fila vacía lista
}

/**
 * Añade una fila dinámica al constructor de ingredientes.
 * Popula el select de insumos desde el inventario cargado.
 */
async function agregarFilaIngrediente() {
    const tbody = document.getElementById('tabla-form-ingredientes');
    if (!tbody) return;

    // Cargar insumos si no están en caché
    if (_supplyCache.length === 0) {
        const { data } = await supabaseClient
            .from('inventory_supplies')
            .select('id, item_name, unit_of_measure')
            .order('item_name');
        _supplyCache = data || [];
    }

    const opts = _supplyCache.map(s =>
        `<option value="${s.id}" data-unit="${s.unit_of_measure}">${s.item_name} (${s.unit_of_measure})</option>`
    ).join('');

    const idFila = `ing_${Date.now()}`;
    tbody.insertAdjacentHTML('beforeend', `
        <tr id="${idFila}" class="ing-row" style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 8px;">
                <select class="ing-supply-select" onchange="_autoFillUnit(this,'${idFila}')"
                    style="font-size:12px;border-radius:999px;padding:6px 12px;height:34px;min-width:200px;">
                    <option value="">— Insumo del inventario —</option>
                    ${opts}
                </select>
                <input type="hidden" class="ing-supply-id">
                <input type="text" class="ing-supply-name" placeholder="o escribe nombre manual"
                    style="font-size:12px;border-radius:999px;padding:5px 12px;height:34px;margin-top:4px;">
            </td>
            <td style="padding:6px 8px;width:110px;">
                <input type="number" class="ing-qty" placeholder="Ej: 1" min="0.01" step="0.01"
                    style="font-size:12px;border-radius:999px;padding:5px 12px;height:34px;">
            </td>
            <td style="padding:6px 8px;width:120px;">
                <input type="text" class="ing-unit" placeholder="Libras, Kg…"
                    style="font-size:12px;border-radius:999px;padding:5px 12px;height:34px;">
            </td>
            <td style="padding:6px 8px;width:40px;text-align:center;">
                <button onclick="document.getElementById('${idFila}').remove()"
                    style="background:var(--red-lt);border:1.5px solid var(--red-bd);color:var(--red);border-radius:999px;width:28px;height:28px;cursor:pointer;font-size:14px;font-family:'DM Sans',sans-serif;">×</button>
            </td>
        </tr>`);
}

function _autoFillUnit(selectEl, filaId) {
    const fila   = document.getElementById(filaId);
    if (!fila) return;
    const opt    = selectEl.options[selectEl.selectedIndex];
    const unit   = opt?.dataset?.unit || '';
    const name   = opt?.text?.split(' (')[0] || '';
    const id     = opt?.value || '';
    fila.querySelector('.ing-supply-id').value   = id;
    fila.querySelector('.ing-supply-name').value = name;
    fila.querySelector('.ing-unit').value        = unit;
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

// ──────────────────────────────────────────────
// CALCULADORA DE PRODUCCIÓN
// Lógica: platos = FLOOR( MIN(stock_i / qty_requerida_i) )
// ──────────────────────────────────────────────
async function calcularProduccion() {
    const sel       = document.getElementById('sel-receta-calculo');
    const recetaId  = sel?.value;
    if (!recetaId) { Toast.error('Selecciona una receta base primero.'); return; }

    const receta = _recetasCache.find(r => r.id === recetaId);
    if (!receta || !receta.recipe_ingredients?.length) {
        Toast.error('La receta seleccionada no tiene ingredientes definidos.');
        return;
    }

    // Obtener stocks actuales de los insumos usados en la receta
    const supplyIds = receta.recipe_ingredients
        .filter(i => i.supply_id)
        .map(i => i.supply_id);

    let stockMap = {};
    if (supplyIds.length > 0) {
        const { data: stocks } = await supabaseClient
            .from('inventory_supplies')
            .select('id, item_name, current_stock, unit_of_measure')
            .in('id', supplyIds);
        (stocks || []).forEach(s => { stockMap[s.id] = s; });
    }

    // Calcular platos posibles por cada ingrediente: FLOOR(stock / qty_requerida)
    let platosMaximos = Infinity;
    const detalleIngredientes = receta.recipe_ingredients.map(ing => {
        const stockActual = stockMap[ing.supply_id]?.current_stock ?? 0;
        const posibles    = ing.quantity_required > 0
            ? Math.floor(stockActual / ing.quantity_required)
            : Infinity;
        if (posibles < platosMaximos) platosMaximos = posibles;
        return {
            ...ing,
            stockActual,
            posibles,
            consumo_por_plato: ing.quantity_required,
        };
    });

    if (!isFinite(platosMaximos)) platosMaximos = 0;

    _calcResult = { recetaId, receta, platosMaximos, ingredientes: detalleIngredientes };
    _renderResultadoCalculo();
}

function _renderResultadoCalculo() {
    const panel = document.getElementById('panel-resultado-calculo');
    if (!panel || !_calcResult) return;
    const { receta, platosMaximos, ingredientes } = _calcResult;

    const filasIng = ingredientes.map(i => {
        const consumoTotal = (i.consumo_por_plato * platosMaximos).toFixed(2);
        const stockRestante = Math.max(0, i.stockActual - i.consumo_por_plato * platosMaximos).toFixed(2);
        const alerta = parseFloat(stockRestante) <= 2
            ? `<span style="color:var(--red);font-size:10px;font-weight:700;">⚠️ Stock bajo tras producción</span>` : '';
        return `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px 10px;font-size:12.5px;font-weight:600;color:var(--text-1);">${i.supply_name}</td>
            <td style="padding:8px 10px;text-align:center;" class="mono">${i.stockActual} ${i.unit}</td>
            <td style="padding:8px 10px;text-align:center;" class="mono">${i.consumo_por_plato} ${i.unit}</td>
            <td style="padding:8px 10px;text-align:center;color:var(--red);" class="mono">-${consumoTotal} ${i.unit}</td>
            <td style="padding:8px 10px;text-align:center;color:var(--olive);" class="mono">${stockRestante} ${i.unit} ${alerta}</td>
        </tr>`;
    }).join('');

    panel.style.display = 'block';
    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
            <div>
                <p style="font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">
                    Resultado — ${receta.name}
                </p>
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:32px;font-weight:800;color:var(--olive);" class="mono">${platosMaximos}</span>
                    <span style="font-size:14px;color:var(--text-2);">platos posibles con el stock actual</span>
                </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <div style="text-align:center;background:var(--surface-2);border:1.5px solid var(--border);border-radius:12px;padding:10px 18px;">
                    <p style="font-size:9.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;">Rinde por ciclo</p>
                    <p style="font-size:18px;font-weight:700;color:var(--blue);" class="mono">${receta.yield_portions}</p>
                </div>
            </div>
        </div>
        <div style="overflow-x:auto;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:14px;">
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:var(--surface-2);">
                        <th style="padding:9px 10px;font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.6px;text-align:left;">Insumo</th>
                        <th style="padding:9px 10px;font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.6px;text-align:center;">Stock Actual</th>
                        <th style="padding:9px 10px;font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.6px;text-align:center;">Por Plato</th>
                        <th style="padding:9px 10px;font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.6px;text-align:center;">Consumo Total</th>
                        <th style="padding:9px 10px;font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.6px;text-align:center;">Stock Restante</th>
                    </tr>
                </thead>
                <tbody>${filasIng}</tbody>
            </table>
        </div>
        ${platosMaximos > 0 ? `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <label style="font-size:12.5px;font-weight:600;color:var(--text-2);margin:0;">Platos vendidos a descontar:</label>
            <input type="number" id="inp-platos-vendidos" value="${platosMaximos}" min="1" max="${platosMaximos}"
                style="width:90px;font-size:13px;font-weight:700;text-align:center;border-radius:999px;padding:6px 12px;">
            <button onclick="descontarInsumos()" class="btn-olive">
                📦 Descontar del Inventario
            </button>
        </div>` : `<p style="font-size:12.5px;color:var(--red);font-weight:600;">⚠️ Stock insuficiente para producir al menos un plato.</p>`}`;
}

/**
 * Descuenta los insumos del inventario según los platos vendidos.
 * new_stock_i = current_stock_i - (qty_requerida_i × platos_vendidos)
 */
async function descontarInsumos() {
    if (!_calcResult) return;
    const platosVendidos = parseInt(document.getElementById('inp-platos-vendidos')?.value) || 0;
    if (platosVendidos <= 0 || platosVendidos > _calcResult.platosMaximos) {
        Toast.error(`Ingresa una cantidad entre 1 y ${_calcResult.platosMaximos}.`);
        return;
    }
    if (!confirm(`¿Descontar insumos por ${platosVendidos} plato(s) del inventario?`)) return;

    const ings = _calcResult.ingredientes.filter(i => i.supply_id);
    let errores = 0;

    for (const ing of ings) {
        const nuevoStock = Math.max(0, ing.stockActual - ing.consumo_por_plato * platosVendidos);
        const { error } = await supabaseClient
            .from('inventory_supplies')
            .update({ current_stock: nuevoStock, updated_at: new Date().toISOString() })
            .eq('id', ing.supply_id);
        if (error) { console.error('Error descontando', ing.supply_name, error); errores++; }
    }

    if (errores === 0) {
        Toast.ok(`✅ ${platosVendidos} plato(s) registrados. Inventario actualizado.`);
    } else {
        Toast.error(`Se actualizaron algunos insumos, pero ${errores} fallaron. Revisa la consola.`);
    }

    _calcResult = null;
    document.getElementById('panel-resultado-calculo').style.display = 'none';
    document.getElementById('sel-receta-calculo').value = '';
    cargarInventarioReal();
    cargarRecetas();
}

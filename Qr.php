<?php
require_once __DIR__ . '/vendor/autoload.php';

use Chillerlan\QRCode\{QRCode, QROptions};

$url = 'https://restaurantela26.vercel.app/carta.html';

// Configuración para salida en SVG puro
$options = new QROptions([
    'version'      => 5,
    'outputType'   => QRCode::OUTPUT_MARK_SVG,
    'eccLevel'     => QRCode::ECC_L,
    'svgConnectPaths' => true // Hace que el SVG sea más limpio
]);

// Instanciar y renderizar
$qrcode = new QRCode($options);
$svg_code = $qrcode->render($url);
?>

<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>QR de la Carta</title>
    <style>
        .qr-container {
            width: 250px;
            height: 250px;
            fill: #000000; /* Puedes cambiar el color del QR desde aquí */
        }
    </style>
</head>
<body>
    <h1>Escanea la carta aquí</h1>
    
    <div class="qr-container">
        <?php echo $svg_code; ?>
    </div>
</body>
</html>

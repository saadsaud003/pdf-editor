<?php
$sizes = [72, 96, 128, 144, 152, 192, 384, 512];
$dir = __DIR__ . '/icons/';

foreach ($sizes as $size) {
    $img = imagecreatetruecolor($size, $size);
    imagesavealpha($img, true);

    // Background - rounded blue
    $blue = imagecolorallocate($img, 59, 130, 246);
    $white = imagecolorallocate($img, 255, 255, 255);
    $darkBlue = imagecolorallocate($img, 30, 64, 175);

    imagefilledrectangle($img, 0, 0, $size, $size, $blue);

    // Draw PDF icon shape
    $margin = (int)($size * 0.2);
    $docW = $size - $margin * 2;
    $docH = (int)($size * 0.7);
    $docX = $margin;
    $docY = (int)($size * 0.15);

    // Document background
    imagefilledrectangle($img, $docX, $docY, $docX + $docW, $docY + $docH, $white);

    // Folded corner
    $foldSize = (int)($docW * 0.25);
    $foldX = $docX + $docW - $foldSize;
    $foldY = $docY;
    $points = [$foldX, $foldY, $docX + $docW, $foldY + $foldSize, $foldX, $foldY + $foldSize];
    imagefilledpolygon($img, $points, 3, $blue);
    imagefilledrectangle($img, $foldX, $foldY, $docX + $docW, $foldY + $foldSize, $blue);
    $points2 = [$foldX, $foldY, $docX + $docW, $foldY + $foldSize, $foldX, $foldY + $foldSize];
    $lightBlue = imagecolorallocate($img, 147, 197, 253);
    imagefilledpolygon($img, $points2, 3, $lightBlue);

    // "PDF" text
    $fontSize = (int)($size * 0.14);
    $textY = $docY + (int)($docH * 0.6);
    $textX = $docX + (int)($docW * 0.15);

    // Simple text lines to represent content
    $lineColor = imagecolorallocate($img, 200, 210, 230);
    $lineH = max(2, (int)($size * 0.03));
    for ($i = 0; $i < 3; $i++) {
        $ly = $docY + (int)($docH * 0.3) + $i * ($lineH + max(3, (int)($size * 0.06)));
        $lw = $docW - $margin + (int)($size * 0.05);
        if ($i == 2) $lw = (int)($lw * 0.6);
        imagefilledrectangle($img, $docX + (int)($size * 0.05), $ly, $docX + $lw, $ly + $lineH, $lineColor);
    }

    // Red PDF badge
    $badgeH = (int)($size * 0.18);
    $badgeW = (int)($size * 0.45);
    $badgeX = (int)(($size - $badgeW) / 2);
    $badgeY = $docY + $docH - (int)($badgeH * 0.5);
    $red = imagecolorallocate($img, 220, 38, 38);
    imagefilledrectangle($img, $badgeX, $badgeY, $badgeX + $badgeW, $badgeY + $badgeH, $red);

    imagepng($img, $dir . "icon-{$size}.png");
    imagedestroy($img);
}

echo "Icons generated successfully!";
